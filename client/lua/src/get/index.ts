import { GetItem, GetResult, GetOptions } from '~selva/get/types'
import { Id } from '~selva/schema/index'
import getByType from './getByType'
import { Schema } from '../../../src/schema/index'
import * as logger from '../logger'
import { setNestedResult } from './nestedFields'
import inherit from './inherit'
import getWithField, { resolveAll } from './field'
import getArray from './getArray'
import { getSchema } from '../schema/index'
import { ensureArray, isArray } from 'lua/src/util'
import makeNewGetOptions from 'lua/src/get/all'
import getQuery from './query/index'
import * as r from '../redis'

// add error handling
function getField(
  props: GetItem,
  schema: Schema,
  result: GetResult,
  id: Id,
  field?: string,
  language?: string,
  version?: string,
  includeMeta?: boolean,
  ignore?: '$' | '$inherit' | '$list' | '$find' | '$filter' // when from inherit
): boolean {
  let hasAlias = false

  if (props.$value) {
    setNestedResult(result, <string>field, props.$value)
    return true
  }

  if (props.$id && field) {
    const intermediateResult = {}
    const v = getField(
      props,
      schema,
      intermediateResult,
      props.$id,
      undefined,
      language,
      version,
      false,
      ignore
    )

    setNestedResult(result, field, intermediateResult)

    return true
  }

  if (
    (props.$list || props.$find) &&
    ignore !== '$list' &&
    ignore !== '$' &&
    ignore !== '$find'
  ) {
    // field that needs to get the result

    if (field) {
      let sourceField: string | string[] = field
      if (!(props.$list && props.$list.$find) && props.$field) {
        sourceField = resolveAll(
          id,
          schema,
          ensureArray(props.$field),
          language,
          version
        )
      }

      // clean up this property so we don't use it in gets with lists
      delete props.$field

      // allways need a field for getQuery
      const err = getQuery(
        getField,
        schema,
        result,
        props,
        field,
        [id],
        sourceField,
        language,
        version,
        includeMeta
      )
      if (err) {
        // can return an error now
        logger.error(err)
      }
    }
    return true
  } else {
    if (props.$field && field) {
      hasAlias = true

      props.$field = resolveAll(
        id,
        schema,
        ensureArray(props.$field),
        language,
        version
      )

      if (
        getWithField(
          result,
          schema,
          id,
          field,
          props.$field,
          language,
          version,
          includeMeta
        )
      ) {
        return true
      }
    }

    let isComplete = true
    let hasKeys = false
    if (!hasAlias) {
      if (props.$all) {
        props = makeNewGetOptions(id, field || '', schema, props)
      }

      for (const key in props) {
        if (key[0] !== '$') {
          hasKeys = true
          const f = field && field.length > 0 ? field + '.' + key : key
          if (props[key] === true) {
            if (
              !getByType(result, schema, id, f, language, version, includeMeta)
            ) {
              isComplete = false
            }
          } else if (props[key] === false) {
            // skip
          } else if (isArray(props[key])) {
            getArray(
              getField,
              props[key],
              schema,
              result,
              id,
              f,
              language,
              version,
              includeMeta,
              ignore
            )
          } else {
            if (
              getField(
                props[key],
                schema,
                result,
                id,
                f,
                language,
                version,
                includeMeta
              )
            ) {
              isComplete = false
            }
          }
        }
      }
    }

    if (
      (!ignore || (ignore !== '$' && ignore !== '$inherit')) &&
      props.$inherit &&
      (!isComplete || !hasKeys)
    ) {
      if (!hasAlias && !hasKeys) {
        const complete = getByType(
          result,
          schema,
          id,
          <string>field,
          language,
          version,
          includeMeta
        )
        if (!complete) {
          inherit(
            getField,
            props,
            schema,
            result,
            id,
            <string>field,
            language,
            version,
            includeMeta,
            hasAlias ? props.$field : undefined
          )
        }
      } else {
        inherit(
          getField,
          props,
          schema,
          result,
          id,
          <string>field,
          language,
          version,
          includeMeta,
          hasAlias ? props.$field : undefined
        )
      }
    }

    if (props.$default) {
      if (hasAlias) {
        setNestedResult(result, <string>field, props.$default)
        return true
      }

      const complete = getByType(
        result,
        schema,
        id,
        <string>field,
        language,
        version,
        includeMeta
      )
      if (!complete) {
        setNestedResult(result, <string>field, props.$default)
      }
    }

    return isComplete
  }
}

function getRawAncestors(
  id: string,
  result: Record<string, true> = {}
): Record<string, true> {
  let parents = r.smembers(id + '.parents')

  logger.info(parents)

  for (let i = 0; i < parents.length; i++) {
    result[parents[i]] = true
    getRawAncestors(parents[i], result)
  }

  return result
}

function get(opts: GetOptions): GetResult {
  const schema = getSchema()
  const result: GetResult = {}

  // logger.info(`GET ${cjson.encode(opts)}`)
  let {
    $version: version,
    $id: id,
    $alias: alias,
    $language: language,
    $includeMeta: includeMeta,
    $rawAncestors: rawAncestors // subscriptions is shitty
  } = opts

  if (alias) {
    const aliased = r.hget('___selva_aliases', alias)
    if (aliased && aliased.length > 0) {
      id = aliased
    } else {
      return {}
    }
  } else if (!id) {
    id = 'root'
  }

  if (includeMeta) {
    result.$meta = { $refs: {} }
  }

  getField(opts, schema, result, id, undefined, language, version, includeMeta)

  if (rawAncestors) {
    const obj = getRawAncestors(id)
    const arr = []
    for (const id in obj) {
      arr[arr.length] = id
    }
    result.rawAncestors = arr
  }

  return <any>result
}

export default get

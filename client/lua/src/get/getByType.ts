import { Id, FieldSchema } from '~selva/schema/index'

import * as redis from '../redis'
import { getTypeFromId } from '../typeIdMapping'
import { GetResult } from '~selva/get/types'
import {
  setNestedResult,
  getNestedField,
  setMeta,
  getNestedSchema
} from './nestedFields'
import { Schema } from '../../../src/schema/index'
import { tryResolveSimpleRef, resolveObjectRef } from './ref'
import {
  splitString,
  stringStartsWith,
  stringEndsWith,
  joinString,
  ensureArray,
  emptyArray,
  markEmptyArraysInJSON
} from '../util'
import * as logger from '../logger'

const getDotIndex = (str: string): number => {
  for (let i = str.length - 1; i > 1; i--) {
    if (str[i] === '.') {
      return i
    }
  }
  return -1
}

const id = (
  result: GetResult,
  _schema: Schema,
  id: Id,
  _field: string,
  _language?: string,
  _version?: string,
  _merge?: boolean,
  _mergeProps?: any
): boolean => {
  result.id = id
  return true
}

const number = (
  result: GetResult,
  schema: Schema,
  id: Id,
  field: string,
  language?: string,
  version?: string,
  _merge?: boolean,
  _mergeProps?: any
): boolean => {
  const v = redis.hget(id, field)
  if (
    tryResolveSimpleRef(
      result,
      schema,
      id,
      field,
      v,
      getByType,
      language,
      version
    )
  ) {
    return true
  }

  const value = !v ? null : tonumber(v)
  setNestedResult(result, field, value)
  return value !== null
}

const float = (
  result: GetResult,
  schema: Schema,
  id: Id,
  field: string,
  language?: string,
  version?: string,
  _merge?: boolean,
  _mergeProps?: any
): boolean => {
  return number(result, schema, id, field, language, version)
}

const int = (
  result: GetResult,
  schema: Schema,
  id: Id,
  field: string,
  language?: string,
  version?: string,
  _merge?: boolean,
  _mergeProps?: any
): boolean => {
  const v = redis.hget(id, field)

  if (
    tryResolveSimpleRef(
      result,
      schema,
      id,
      field,
      v,
      getByType,
      language,
      version
    )
  ) {
    return true
  }

  const value = !v ? null : Math.floor(tonumber(v))
  setNestedResult(result, field, value)
  return value !== null
}

const boolean = (
  result: GetResult,
  schema: Schema,
  id: Id,
  field: string,
  language?: string,
  version?: string,
  _merge?: boolean,
  _mergeProps?: any
): true => {
  const v = redis.hget(id, field)

  if (
    tryResolveSimpleRef(
      result,
      schema,
      id,
      field,
      v,
      getByType,
      language,
      version
    )
  ) {
    return true
  }
  const value = v === 'true' ? true : false
  setNestedResult(result, field, value)
  return true
}

const string = (
  result: GetResult,
  schema: Schema,
  id: Id,
  field: string,
  language?: string,
  version?: string,
  _merge?: boolean,
  _mergeProps?: any
): boolean => {
  const value = redis.hget(id, field) || ''

  if (
    tryResolveSimpleRef(
      result,
      schema,
      id,
      field,
      value,
      getByType,
      language,
      version
    )
  ) {
    return true
  }

  setNestedResult(result, field, value)
  return value !== null && value.length > 0
}

const arrayLike = (
  result: GetResult,
  schema: Schema,
  id: Id,
  field: string,
  language?: string,
  version?: string,
  _merge?: boolean,
  _mergeProps?: any
): boolean => {
  if (field === 'ancestors') {
    return ancestors(result, schema, id, field, language, version)
  } else if (field === 'descendants') {
    return descendants(result, id, field, language, version)
  }

  let value = ensureArray(redis.smembers(id + '.' + field))
  if (value.length === 0 || !value.length) {
    value = emptyArray()
    setNestedResult(result, field, value)
    return false
  }

  setNestedResult(result, field, value)
  return !!value.length
}

const json = (
  result: GetResult,
  schema: Schema,
  id: Id,
  field: string,
  language?: string,
  version?: string,
  _merge?: boolean,
  _mergeProps?: any
): boolean => {
  let value = redis.hget(id, field)

  if (!value) {
    return false
  }

  let isString = true
  if (type(value) === 'string') {
    if (
      tryResolveSimpleRef(
        result,
        schema,
        id,
        field,
        value,
        getByType,
        language,
        version
      )
    ) {
      return true
    }

    value = markEmptyArraysInJSON(value)
  } else {
    isString = false
  }

  setNestedResult(result, field, isString ? cjson.decode(value) : null)
  return value !== null
}

const array = (
  result: GetResult,
  _schema: Schema,
  id: Id,
  field: string,
  _language?: string,
  _version?: string,
  _merge?: boolean,
  _mergeProps?: any
): boolean => {
  const value = redis.hget(id, field)
  let decoded: never[] | null =
    type(value) === 'string' ? cjson.decode(value) : null
  if (decoded === null || decoded.length === 0 || !decoded.length) {
    decoded = emptyArray()
    setNestedResult(result, field, decoded)
    return false
  }

  setNestedResult(result, field, decoded)
  return true
}

const object = (
  result: GetResult,
  schema: Schema,
  id: Id,
  field: string,
  language?: string,
  version?: string,
  merge?: boolean,
  mergeProps?: any
): boolean => {
  const keys = redis.hkeys(id)
  let isComplete = true
  let noKeys = true

  let usedResult = merge ? {} : result
  for (const key of keys) {
    if (key.indexOf(field) === 0) {
      noKeys = false

      if (stringEndsWith(key, '$ref')) {
        return resolveObjectRef(
          usedResult,
          schema,
          id,
          field,
          getByType,
          language,
          version
        )
      }

      if (!getByType(usedResult, schema, id, key, language, version)) {
        isComplete = false
      }
    }
  }

  if (merge) {
    for (const key of keys) {
      if (key.indexOf(field) === 0) {
        const keyPartsAfterField = splitString(
          key.substring(field.length + 1),
          '.'
        )[0]
        const topLevelPropertyField = field + '.' + keyPartsAfterField

        const intermediate = getNestedField(usedResult, topLevelPropertyField)
        const nested = getNestedField(result, topLevelPropertyField)
        if (
          !nested ||
          nested === '' ||
          (type(nested) === 'table' && next(nested) === null)
        ) {
          setNestedResult(result, topLevelPropertyField, intermediate)
        }
      }
    }

    if (mergeProps && mergeProps.properties) {
      for (const topLevelKey in mergeProps.properties) {
        const fullPathToKey = field + '.' + topLevelKey
        const nested = getNestedField(result, fullPathToKey)
        if (
          !nested ||
          nested === '' ||
          (type(nested) === 'table' && next(nested) === null)
        ) {
          return false
        }
      }

      return true
    }

    return false
  }

  return noKeys ? false : isComplete
}

const text = (
  result: GetResult,
  schema: Schema,
  id: Id,
  field: string,
  language?: string,
  version?: string,
  _merge?: boolean,
  _mergeProps?: any
): boolean => {
  if (!language) {
    const isComplete = object(result, schema, id, field, language, version)
    if (!isComplete) {
      const value = getNestedField(result, field)
      if (!value) {
        return false
      }

      for (const key in value) {
        if (value[key]) {
          return true
        }
      }
      return false
    } else {
      return true
    }
  } else {
    const value = redis.hget(id, field + '.' + language)
    if (value) {
      setNestedResult(result, field, value)
      return true
    } else {
      const keys = redis.hkeys(id)
      for (let i = 0; i < keys.length; i++) {
        if (stringStartsWith(keys[i], field + '.')) {
          const value = redis.hget(id, keys[i])
          if (value) {
            setNestedResult(result, field, value)
            return true
          }
        }
      }

      setNestedResult(result, field, '')
      return false
    }
  }
}

const ancestors = (
  result: GetResult,
  _schema: Schema,
  id: Id,
  _field: string,
  _language?: string,
  _version?: string
): true => {
  result.ancestors = redis.zrange(id + '.ancestors', 0, -1) || []
  return true
}

const getDescendants = (
  id: Id,
  results: Record<Id, true>,
  passedId: Record<Id, true>
): Record<Id, true> => {
  if (!passedId[id]) {
    const children = redis.smembers(id + '.children')
    for (const id of children) {
      results[id] = true
    }
    passedId[id] = true
    for (const c of children) {
      getDescendants(c, results, passedId)
    }
  }
  return results
}

const descendants = (
  result: GetResult,
  id: Id,
  _field: string,
  _language?: string,
  _version?: string
): true => {
  const s = getDescendants(id, {}, {})
  let r: string[] = []
  let idx = 0
  for (let key in s) {
    r[idx] = key
    idx++
  }

  if (r.length === 0 || !r.length) {
    r = emptyArray()
  }

  result.descendants = r
  return true
}

const geo = (
  result: GetResult,
  _schema: Schema,
  id: Id,
  field: string,
  _language?: string,
  _version?: string
): true => {
  const coord = redis.hget(id, field)
  const [lon, lat] = splitString(coord, ',')

  setNestedResult(result, field, { lat: tonumber(lat), lon: tonumber(lon) })
  return true
}

const types = {
  id,
  string,
  digest: string,
  number,
  float,
  int,
  boolean,
  object,
  set: arrayLike,
  reference: string,
  references: arrayLike,
  json,
  array,
  text,
  timestamp: number,
  url: string,
  email: string,
  phone: string,
  geo,
  type: string,
  descendants,
  ancestors
}

function getByType(
  result: GetResult,
  schema: Schema,
  id: Id,
  field: string,
  language?: string,
  version?: string,
  merge?: boolean,
  metaKeys?: any
): boolean {
  // version still missing!

  let prop: any
  const lastDotIdx = getDotIndex(field)
  if (lastDotIdx >= 0) {
    // could be a text
    const beforeDot = field.substr(0, lastDotIdx)
    const maybeTextProp = getNestedSchema(id, beforeDot)
    if (maybeTextProp && maybeTextProp.type === 'text') {
      logger.info('IS IT A TEXT PROP?', field)
      if (language) {
        prop = maybeTextProp
        field = beforeDot
      } else {
        prop = { type: 'string' }
      }
    } else {
      prop = getNestedSchema(id, field)
    }
  } else {
    prop = getNestedSchema(id, field)
  }

  if (!prop) {
    return false
  }

  if (field !== 'type' && field !== 'id') {
    if (metaKeys) {
      setMeta(field, metaKeys)
    } else {
      setMeta(field, {
        ___ids: id
      })
    }
  }

  const fn = types[prop.type] || string
  return fn(result, schema, id, field, language, version, merge, prop)
}

export default getByType

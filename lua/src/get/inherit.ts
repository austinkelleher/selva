import * as redis from '../redis'
import { Id, TypeSchema } from '~selva/schema/index'
import { getTypeFromId } from '../typeIdMapping'
import { GetResult, GetItem } from '~selva/get/types'
import { setNestedResult } from './nestedFields'
import getByType from './getByType'
import { ensureArray } from '../util'

type Ancestor = [Ancestor[], number]

// memoize this in lua (within one batch of gets)
// const ancestorMap = {} etc
function createAncestorsInner(id: Id, s: Record<Id, Ancestor>): Ancestor {
  // if memoized[id] -> get it
  if (s[id]) {
    return s[id]
  }
  const parents = redis.smembers(id + '.parents')
  const ancestor: Ancestor = [[], 0]
  if (parents.length) {
    ancestor[1] = 1
    let pd = 0
    for (let pId of parents) {
      const a = createAncestorsInner(pId, s)
      if (a[1] > pd) {
        pd = a[1]
        table.insert(a[0], 1, a)
      } else {
        a[0][a[0].length] = a
      }
    }
    ancestor[1] += pd
  }
  s[id] = ancestor
  return ancestor
}

function createAncestors(targetId: Id): Id[] {
  const s = {}
  createAncestorsInner(targetId, s)
  const result = []
  // binary insert
  for (let id in s) {
    if (targetId !== id) {
      const depth = s[id][1]
      let l = 0,
        r = result.length - 1,
        m = 0
      while (l <= r) {
        m = Math.floor((l + r) / 2)
        const prevDepth = s[result[m]][1]
        if (prevDepth < depth) {
          r = m - 1
        } else {
          l = m + 1
          if (prevDepth === depth) {
            break
          }
        }
      }

      table.insert(result, 1, id)
    }
  }
  return result
}

function createAncestorsFromFields(
  targetId: Id,
  fields: string[],
  // not async in lua
  parse: (id: Id) => string
): Id[] {
  const s = {}
  createAncestorsInner(targetId, s)
  const result = []
  for (let id in s) {
    if (targetId !== id) {
      const ancestor = s[id]
      // get type/name index , store it for faster lookup
      if (ancestor.length === 2) {
        let value = parse(id)
        if (!value) {
          let ignore = false
          for (let i = 0, len = fields.length; i < len; i++) {
            if (fields[i] === value) {
              ancestor.push(i, value)
              break
            } else if (i === len - 1) {
              ignore = true
            }
          }
          if (!ignore) {
          }
          const depth = ancestor[1]
          const index = ancestor[2]
          value = ancestor[3]
          // binary insert
          let l = 0,
            r = result.length - 1,
            m = 0
          while (l <= r) {
            m = Math.floor((l + r) / 2)
            const prev = s[result[m]]
            const prevValue = prev[3]
            if (value === prevValue) {
              const prevDepth = prev[1]
              if (prevDepth < depth) {
                r = m - 1
              } else {
                l = m + 1
                if (prevDepth === depth) {
                  break
                }
              }
            } else {
              const prevIndex = prev[2]
              if (prevIndex > index) {
                r = m - 1
              } else {
                l = m + 1
                if (prevIndex === index) {
                  break
                }
              }
            }
          }
          table.insert(result, 1, id)
        }
      }
    }
  }
  return result
}

function setFromAncestors(
  result: GetResult,
  schemas: Record<string, TypeSchema>,
  ancestors: Id[],
  field: string,
  language?: string,
  version?: string
) {
  for (let i = 0, len = ancestors.length; i < len; i++) {
    if (getByType(result, schemas, ancestors[i], field, language, version)) {
      break
    }
  }
}

function parseName(id: Id): string {
  return redis.hget(id, 'name')
}

function parseType(id: Id): string {
  return getTypeFromId(id)
}

function inheritItem(
  getField: GetFieldFn,
  props: GetItem,
  schemas: Record<string, TypeSchema>,
  result: GetResult,
  id: Id,
  field: string,
  item: string[],
  language?: string,
  version?: string
) {
  const ancestors = createAncestorsFromFields(id, item, parseType)
  const len = ancestors.length
  if (len === 0) {
    setNestedResult(result, field, {})
  } else {
    for (let i = 0; i < len; i++) {
      const intermediateResult = {}
      const isComplete = getField(
        props,
        schemas,
        intermediateResult,
        ancestors[i],
        '',
        language,
        version,
        '$inherit'
      )
      if (isComplete || i === len - 1) {
        setNestedResult(result, field, intermediateResult)
        break
      }
    }
  }
}

type GetFieldFn = (
  props: GetItem,
  schemas: Record<string, TypeSchema>,
  result: GetResult,
  id: Id,
  field?: string,
  language?: string,
  version?: string,
  ignore?: '$' | '$inherit' | '$list' | '$find' | '$filter' // when from inherit
) => boolean

export default function inherit(
  getField: GetFieldFn,
  props: GetItem,
  schemas: Record<string, TypeSchema>,
  result: GetResult,
  id: Id,
  field: string,
  language?: string,
  version?: string
) {
  const inherit = props.$inherit
  if (inherit) {
    if (inherit === true) {
      setFromAncestors(
        result,
        schemas,
        createAncestors(id),
        field,
        language,
        version
      )
    } else if (inherit.$type || inherit.$name) {
      let ancestors: Id[]
      if (inherit.$name) {
        inherit.$name = ensureArray(inherit.$name)
        ancestors = createAncestorsFromFields(id, inherit.$name, parseName)
      } else {
        inherit.$type = ensureArray(inherit.$type)
        ancestors = createAncestorsFromFields(id, inherit.$type, parseType)
      }
      setFromAncestors(result, schemas, ancestors, field, language, version)
    } else if (inherit.$item) {
      inherit.$item = ensureArray(inherit.$item)
      inheritItem(
        getField,
        props,
        result,
        schemas,
        id,
        field,
        inherit.$item,
        language,
        version
      )
    }
  }
}


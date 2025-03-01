import { FilterAST, Meta, QuerySubscription, Fork } from './types'
import * as logger from '../../logger'
import { isFork } from './util'
import { getPrefixFromType } from '../../typeIdMapping'
import { indexOf, isArray, joinString } from '../../util'
import { GetOptions, GetResult } from '~selva/get/types'
import createSearchString from './createSearchString'
import createSearchArgs from './createSearchArgs'
import { Schema } from '../../../../src/schema/index'

const addType = (type: string | number, arr: string[]) => {
  const prefix = getPrefixFromType(tostring(type))
  if (indexOf(arr, prefix) === -1) {
    arr[arr.length] = prefix
  }
}

function parseFork(
  ast: Fork,
  sub: QuerySubscription,
  newAst: Fork,
  timestampFilters: FilterAST[]
) {
  let list: (Fork | FilterAST)[] = []
  let newAstList: (Fork | FilterAST)[] = []
  if (ast.$and) {
    list = ast.$and
    newAst.$and = newAstList
  } else if (ast.$or) {
    list = ast.$or
    newAst.$or = newAstList
  }

  if (list) {
    for (let i = 0; i < list.length; i++) {
      const item = list[i]
      if (isFork(item)) {
        const newNode: Fork = { isFork: true }
        newAstList[i] = newNode
        parseFork(item, sub, newNode, timestampFilters)
      } else {
        let newNode: FilterAST | null = item
        if (item.$field === 'type') {
          if (!sub.type) {
            sub.type = []
          }
          // FIXME: Not completely correct unfortunately
          // for now it just checks if one of the types matches (bit slower but fine)
          if (isArray(item.$value)) {
            for (let j = 0; j < item.$value.length; j++) {
              addType(item.$value[j], sub.type)
            }
          } else {
            addType(item.$value, sub.type)
          }
        } else if (item.$field === 'ancestors') {
          const ancestors: { $field: string; $value: string[] } = {
            $field: 'ancestors',
            $value: []
          }

          const value = !isArray(item.$value) ? [item.$value] : item.$value

          for (let j = 0; j < value.length; j++) {
            ancestors.$value[ancestors.$value.length] = tostring(value[j])
          }

          sub.member[sub.member.length] = ancestors
          // add to member
        } else if (item.$field === 'id') {
          if (!sub.ids) {
            sub.ids = {}
          }

          const value = !isArray(item.$value) ? [item.$value] : item.$value
          for (let j = 0; j < value.length; j++) {
            sub.ids[value[j]] = true
          }
        } else if (item.hasNow) {
          // add to filters and omit from new ast
          newNode = null

          timestampFilters[timestampFilters.length] = item
          sub.fields[item.$field] = true
          // dont even know what to do here :D
          // prob need to add the traverse options and not the ids
        } else {
          sub.fields[item.$field] = true
        }

        if (newNode) {
          newAstList[i] = newNode
        }
      }
    }
  }
}

const parseGet = (
  opts: GetOptions,
  fields: Record<string, true>,
  field: string[]
) => {
  for (let key in opts) {
    if (key[0] !== '$') {
      const item = opts[key]
      if (typeof item === 'object') {
        // logger
        if (!item.$list) {
          const newArray: string[] = []
          for (let i = 0; i < field.length; i++) {
            newArray[newArray.length] = field[i]
          }
          newArray[newArray.length] = key
          parseGet(item, fields, newArray)
        }
      } else {
        fields[
          field.length > 0 ? joinString(field, '.') + '.' + key : key
        ] = true
      }
    }
  }
}

function parseSubscriptions(
  meta: Meta,
  ids: string[],
  getOptions: GetOptions,
  language?: string,
  traverse?: string | string[]
): QuerySubscription {
  const queryId = redis.sha1hex(cjson.encode(getOptions))

  let sub: QuerySubscription = {
    member: [],
    fields: {},
    queryId,
    language
  }

  if (meta.ast) {
    const newAst: Fork = { isFork: meta.ast.isFork }
    const timestampFilters: FilterAST[] = []
    parseFork(meta.ast, sub, newAst, timestampFilters)

    if (timestampFilters.length >= 1) {
      const tsFork: WithRequired<Fork, '$or'> = { isFork: true, $or: [] }
      for (let i = 0; i < timestampFilters.length; i++) {
        const filter = timestampFilters[i]
        tsFork.$or[i] = {
          $field: filter.$field,
          $search: filter.$search,
          $value: filter.$value,
          $operator: '>'
        }
      }

      const withTime: WithRequired<Fork, '$and'> = {
        isFork: true,
        $and: [tsFork, newAst]
      }

      let [qs] = createSearchString(withTime)
      const q = qs[0]

      let earliestTime: number | undefined = undefined
      for (let i = 0; i < timestampFilters.length; i++) {
        const newArgs = createSearchArgs(
          {
            $list: {
              $sort: {
                $field: timestampFilters[i].$field, // it's actually not so easy to decide which timestamp field should be the basis of sorting
                $order: 'asc'
              },
              $limit: 1
            }
          },
          string.sub(q, 2, q.length - 1),
          withTime
        )

        const newSearchResults: string[] = redis.pcall(
          'ft.search',
          'default',
          ...newArgs
        )

        const earliestId = newSearchResults[1]
        if (earliestId) {
          const timeResp = redis.call(
            'hget',
            earliestId,
            timestampFilters[i].$field
          )

          if (timeResp) {
            const time = tonumber(timeResp)
            if (!earliestTime || earliestTime > time) {
              earliestTime = time
            }
          }
        }
      }

      if (earliestTime) {
        sub.time = {
          nextRefresh: earliestTime
        }
      }
    }
  } else {
    if (!sub.ids) {
      sub.ids = {}
    }
    for (let i = 1; i < meta.ids.length; i++) {
      sub.ids[meta.ids[i]] = true
    }
    if (meta.type) {
      sub.type = meta.type
    }
  }

  if (sub.ids || !meta.ast) {
    if (!sub.idFields) {
      sub.idFields = {}
    }
    const field = meta.traverse || traverse
    if (!field) {
      logger.error('WRONG MISSING FIELD or TRAVERSE')
    } else {
      for (let i = 0; i < ids.length; i++) {
        sub.idFields[`${ids[i]}.${field}`] = true
      }
    }
  }

  let sort = meta.sort
  if (sort) {
    if (!isArray(sort)) {
      sort = [sort]
    }
    for (let i = 0; i < sort.length; i++) {
      sub.fields[sort[i].$field] = true
    }
  }

  return sub
}

export default parseSubscriptions

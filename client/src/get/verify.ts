import { GetOptions, Inherit, List, Sort } from './types'
import { SelvaClient } from '..'

function checkAllowed(props: GetOptions, allowed: Set<string>): true | string {
  for (const key in props) {
    if (!allowed.has(key)) {
      return key
    }
  }

  return true
}

function validateField(
  client: SelvaClient,
  field: string | string[] | { path: string | string[]; value: GetOptions },
  path: string
): void {
  if (typeof field === 'string') {
    return
  }

  if (typeof field === 'object') {
    if (Array.isArray(field)) {
      return
    }

    const allowed = checkAllowed(<GetOptions>field, new Set(['path', 'value']))
    if (allowed !== true) {
      throw new Error(
        `Unsupported option ${allowed} in operator $field for ${path}.$field`
      )
    }

    return validateTopLevel(client, field.value, path)
  }

  throw new Error(
    `Unsupported type in operator $field for ${path}.$field. Required type string, array of strings or object { path: string | string[]; value: GetOptions }`
  )
}

function validateInherit(
  client: SelvaClient,
  inherit: Inherit,
  path: string
): void {
  const err = (mainMsg?: string): never => {
    if (!mainMsg) {
      mainMsg = 'Unsupported type in operator $inherit'
    }

    throw new Error(
      `${mainMsg} for ${path}.$inherit. Required type boolean or object with any of the following singatures: 
        {
          $item: string | string[] (type)
          $required: string | string[] (field name) (optional)
        } 
        or
        {
          $type: string | string[] or $name?: string | string[] but not both (optional)
          $merge: boolean (optional)
        }
    `
    )
  }

  if (typeof inherit === 'boolean') {
    return
  }

  // TODO: check more types in $name and $type
  if (typeof inherit === 'object') {
    if (inherit.$type) {
      if (inherit.$name) {
        err('Both $type and $name are not supported')
      }

      const allowed = checkAllowed(inherit, new Set(['$type', '$merge']))
      if (allowed !== true) {
        err(`Field or operator ${allowed} not allowed in inherit with $type`)
      }

      return
    } else if (inherit.$name) {
      const allowed = checkAllowed(inherit, new Set(['$name', '$merge']))
      if (allowed !== true) {
        err(`Field or operator ${allowed} not allowed in inherit with $name`)
      }

      return
    } else if (inherit.$item) {
      const allowed = checkAllowed(inherit, new Set(['$item', '$required']))
      if (allowed !== true) {
        err(`Field or operator ${allowed} not allowed in inherit with $type`)
      }

      if (!Array.isArray(inherit.$item) && typeof inherit.$item !== 'string') {
        err(`Inherit by $type must target a specific type or array of types`)
      }

      if (
        !Array.isArray(inherit.$required) &&
        typeof inherit.$required !== 'string'
      ) {
        err(
          `In inherit by $type the $required operator must be a field name or array of field names`
        )
      }

      return
    }

    err(`Object for $inherit without furhter operators specified`)
  }

  err()
}

function validateSort(client: SelvaClient, sort: Sort, path: string): void {
  const err = (mainMsg?: string): never => {
    if (!mainMsg) {
      mainMsg = 'Unsupported type in operator $sort'
    }

    throw new Error(
      `${mainMsg} for ${path}.$sort. Required type object with the following properties:
        {
          $field: string
          $order: 'asc' | 'desc' (optional)
        }
    `
    )
  }

  const allowed = checkAllowed(sort, new Set(['$field', '$order']))
  if (allowed !== true) {
    err(`Unsupported operator or field ${allowed}`)
  }
}

function validateList(client: SelvaClient, list: List, path: string): void {
  const err = (mainMsg?: string): never => {
    if (!mainMsg) {
      mainMsg = 'Unsupported type in operator $list'
    }

    throw new Error(
      `${mainMsg} for ${path}.$list. Required type boolean or object with any of the following properties:
        {
          $offset: number (optional)
          $limit: number (optional)
          $sort: { $field: string, $order?: 'asc' | 'desc' } or array of these sort objects (optional)
          $find: FindOptions (optional) -- see below
          $inherit: InheritOptions (optional) -- see below            
        }

        FindOptions:
          {
            $traverse: 'descendants' | 'ancestors' | string | string[] (optional)
            $filter: Filter | FilterOptions[] (optional)
            $find: FindOptions (recursive find to find within the results) (optional) 
          }

        FilterOptions:
          {
            $operator: '=' | '!=' | '>' | '<' | '..'
            $field: string
            $value: string | number | (string | number)[]
            $and: FilterOptions (adds an additional condition) (optional)
            $or: FilterOptions (adds optional condition) (optional)
          }

        // TODO: put these in an object so they don't have to be copied
        InheritOptions:
        true
        or
        {
          $item: string | string[] (type)
          $required: string | string[] (field name) (optional)
        } 
        or
        {
          $type: string | string[] or $name?: string | string[] but not both (optional)
          $merge: boolean (optional)
        }
    `
    )
  }

  if (typeof list === 'boolean') {
    return
  }

  if (typeof list === 'object') {
    for (const field in list) {
      if (!field.startsWith('$')) {
        err(
          `Only operators starting with $ are allowed in $list, ${field} not allowed`
        )
      } else if (field === '$offset') {
        if (typeof list.$offset !== 'number') {
          err(`$offset has to be an number, ${list.$offset} specified`)
        }
      } else if (field === '$limit') {
        if (typeof list.$limit !== 'number') {
          err(`$limit has to be an number, ${list.$limit} specified`)
        }
      } else if (field === '$sort') {
      } else if (field === '$find') {
      } else if (field === '$inherit') {
      } else {
        err(`Operator ${field} not allowed`)
      }
    }
  }

  err()
}

function validateNested(
  client: SelvaClient,
  props: GetOptions | true,
  path: string
): void {
  if (props === true) {
    // TODO: validate from schema if id?
    return
  }

  for (const field in props) {
    if (field.startsWith('$')) {
      // TODO: validate that options that aren't supported together are not put together
      if (field === '$field') {
        validateField(client, props.$field, path)
      } else if (field === '$inherit') {
        validateInherit(client, props.$inherit, path)
      } else if (field === '$list') {
      } else if (field === '$find') {
      } else if (field === '$default') {
      } else if (field === '$all') {
      } else if (field === '$value') {
      } else {
        throw new Error(
          `Operator ${field} is not supported in nested fields for ${path +
            '.' +
            field}`
        )
      }
    }
  }

  for (const field in props) {
    if (!field.startsWith('$')) {
    }
  }
}

function validateTopLevel(
  client: SelvaClient,
  props: GetOptions,
  path: string
): void {
  for (const field in props) {
    if (field.startsWith('$')) {
      if (field === '$id') {
        if (typeof props.$id !== 'string' && !Array.isArray(props.$id)) {
          if (path !== '' && typeof props.$id === 'object') {
            const allowed = checkAllowed(props.$id, new Set(['$field']))
            if (allowed !== true) {
              throw new Error(
                `${path}.$id is an object and with unallowed field ${allowed}, only $field is allowed in $id of nested ueries`
              )
            }

            continue
          }

          if (path !== '') {
            throw new Error(
              `$id ${props.$id} in a nested query should be a string, an array of strings or an object with $field reference`
            )
          } else {
            throw new Error(
              `$id ${props.$id} should be a string or an array of strings`
            )
          }
        }
      } else if (field === '$alias') {
        if (typeof props.$alias !== 'string' && !Array.isArray(props.$alias)) {
          throw new Error(
            `${path}.$alias ${props.$alias} should be a string or an array of strings`
          )
        }
      } else if (field === '$version') {
        if (typeof props.$id !== 'string') {
          throw new Error(`$version should be a string`)
        }
      } else if (field === '$language') {
        if (
          typeof props.$language !== 'string' ||
          !client.schema.languages ||
          !client.schema.languages.includes(props.$language)
        ) {
          throw new Error(
            `$language ${
              props.$language
            } is unsupported, should be a string and one of ${[].join(', ')}`
          )
        }
      } else if (field === '$rawAncestors') {
        if (typeof props.$rawAncestors !== 'boolean') {
          throw new Error(`$rawAncestors should be a boolean value`)
        }
      } else {
        // TODO: validate certain GetField options, like $all
        throw new Error(`
          Top level query operator ${field} is not supported. Did you mean one of the following supported top level query options?
            - $id
            - $alias
            - $version
            - $language
          `)
      }
    }
  }

  for (const field in props) {
    if (!field.startsWith('$')) {
      validateNested(client, props[field], path + '.' + field)
    }
  }
}

export default function(client: SelvaClient, props: GetOptions): void {
  validateTopLevel(client, props, '')
}

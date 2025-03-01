import { SetOptions } from '../types'
import { Schema, FieldSchemaArrayLike } from '../../schema'
import parseSetObject from '../validate'
import parsers from './simple'

const verifySimple = (payload, verify) => {
  if (Array.isArray(payload)) {
    return payload.map(v => verify(v))
  } else {
    return [verify(payload)]
  }
}

const parseObjectArray = (payload: any, schema: Schema) => {
  if (Array.isArray(payload) && typeof payload[0] === 'object') {
    return payload.map(ref => parseSetObject(ref, schema))
  }
}

// function isArrayLike(x: any): x is FieldSchemaArrayLike {
//   return x && !!x.items
// }

export default (
  schema: Schema,
  field: string,
  payload: SetOptions,
  result: SetOptions,
  fields: FieldSchemaArrayLike,
  type: string
): void => {
  const typeSchema = type === 'root' ? schema.rootType : schema.types[type]
  if (!typeSchema) {
    throw new Error('Cannot find type schema ' + type)
  }

  if (!fields || !fields.items) {
    throw new Error(`Cannot find field ${field} on ${type}`)
  }
  const fieldType = fields.items.type
  const parser = parsers[fieldType]
  if (!parser) {
    throw new Error(`Cannot find parser for ${fieldType}`)
  }

  const verify = v => {
    const r: { value: any } = { value: undefined }
    parser(schema, 'value', v, r, fields, type)
    return r.value
  }

  if (typeof payload === 'object' && !Array.isArray(payload)) {
    result[field] = {}
    for (let k in payload) {
      if (k === '$add') {
        const parsed = parseObjectArray(payload[k], schema)
        if (parsed) {
          result[field].$add = parsed
        } else if (
          typeof payload[k] === 'object' &&
          !Array.isArray(payload[k])
        ) {
          result[field].$add = [parseSetObject(payload[k], schema)]
        } else {
          result[field].$add = verifySimple(payload[k], verify)
        }
      } else if (k === '$delete') {
        result[field].$delete = verifySimple(payload[k], verify)
      } else {
        throw new Error(`Wrong key for set ${k}`)
      }
    }
  } else {
    result[field] =
      parseObjectArray(payload, schema) || verifySimple(payload, verify)
  }
}

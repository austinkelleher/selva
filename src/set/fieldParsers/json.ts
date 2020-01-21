import { SetOptions } from '../types'
import { TypeSchema, FieldSchemaJson } from '../../schema'

export default (
  schemas: Record<string, TypeSchema>,
  field: string,
  payload: SetOptions,
  result: SetOptions,
  fields: FieldSchemaJson,
  type: string
): void => {
  console.log('😘  json', field)
  // ---
}

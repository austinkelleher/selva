import { Id, Schema } from '~selva/schema/index'
import { GetResult } from '~selva/get/types'
import * as redis from '../redis'
import { setNestedResult, getNestedField } from '../get/nestedFields'
import * as logger from '../logger'

const REF_SIMPLE_FIELD_PREFIX = '___selva_$ref:'

type GetByTypeFn = (
  result: GetResult,
  schema: Schema,
  id: Id,
  field: string,
  language?: string,
  version?: string,
  includeMeta?: boolean
) => boolean

export function resolveObjectRef(
  result: GetResult,
  schema: Schema,
  id: Id,
  field: string,
  getByType: GetByTypeFn,
  language?: string,
  version?: string,
  includeMeta?: boolean
) {
  const ref = redis.hget(id, `${field}.$ref`)
  if (!ref || ref.length === 0) {
    return false
  }

  return resolveRef(
    result,
    schema,
    id,
    field,
    ref,
    getByType,
    language,
    version,
    includeMeta
  )
}

export function tryResolveSimpleRef(
  result: GetResult,
  schema: Schema,
  id: Id,
  field: string,
  value: string,
  getByType: GetByTypeFn,
  language?: string,
  version?: string,
  includeMeta?: boolean
): boolean {
  if (!value || value.indexOf(REF_SIMPLE_FIELD_PREFIX) !== 0) {
    return false
  }

  const ref = value.substring(REF_SIMPLE_FIELD_PREFIX.length)
  resolveRef(
    result,
    schema,
    id,
    field,
    ref,
    getByType,
    language,
    version,
    includeMeta
  )

  return true
}

function resolveRef(
  result: GetResult,
  schema: Schema,
  id: Id,
  field: string,
  ref: string,
  getByType: GetByTypeFn,
  language?: string,
  version?: string,
  includeMeta?: boolean
): boolean {
  if (includeMeta) {
    let current = result.$meta.$refs[ref]
    if (!current) {
      current = [field]
    } else {
      current[current.length] = field
    }

    result.$meta.$refs[ref] = current
  }

  const intermediateResult = {}
  const found = getByType(
    intermediateResult,
    schema,
    id,
    ref,
    language,
    version,
    includeMeta
  )

  if (found) {
    const nested = getNestedField(intermediateResult, ref)
    if (nested) {
      setNestedResult(result, field, nested)
      return true
    }
  }

  return false
}

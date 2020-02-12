import { default as RedisClient, ConnectOptions } from './redis'
// import { id, IdOptions } from './id'
import { set, SetOptions } from './set'
import { ModifyOptions, ModifyResult } from './modifyTypes'
import { deleteItem, DeleteOptions } from './delete'
import { get, GetOptions, GetResult } from './get'
import { observe } from './observe/index'
import { readFileSync } from 'fs'
import { join as pathJoin } from 'path'
import { Schema, SearchIndexes, SchemaOptions, Id } from './schema'
import { newSchemaDefinition } from './schema/updateSchema'
import { getSchema } from './schema/getSchema'
import getTypeFromId from './getTypeFromId'
import digest from './digest'
import { IdOptions } from '../../lua/src/id'
import { v4 as uuid } from 'uuid'

const MAX_SCHEMA_UPDATE_RETRIES = 5

type LogLevel = 'info' | 'notice' | 'warning' | 'error' | 'off'

export type SelvaOptions = {
  loglevel?: LogLevel
}

let SCRIPTS
try {
  SCRIPTS = ['modify', 'fetch', 'id', 'update-schema'].reduce(
    (obj, scriptName) => {
      let distPath = pathJoin(__dirname, '..', '..')
      if (!distPath.endsWith('dist')) {
        distPath = pathJoin(distPath, 'dist')
      }

      return Object.assign(obj, {
        [scriptName]: readFileSync(
          pathJoin(distPath, 'lua', `${scriptName}.lua`),
          'utf8'
        )
      })
    },
    {}
  )
} catch (e) {
  console.error(`Failed to read modify.lua ${e.stack}`)
  process.exit(1)
}

export class SelvaClient {
  public schema: Schema
  public searchIndexes: SearchIndexes
  public redis: RedisClient
  private loglevel: LogLevel = 'warning'
  private clientId: string

  constructor(
    opts: ConnectOptions | (() => Promise<ConnectOptions>),
    selvaOpts?: SelvaOptions
  ) {
    this.clientId = uuid()
    this.redis = new RedisClient(opts)
    this.redis.subscriptionManager.configureLogs(this.clientId)

    if (selvaOpts && selvaOpts.loglevel) {
      this.loglevel = selvaOpts.loglevel
    }
  }

  digest(payload: string) {
    return digest(payload)
  }

  async destroy() {
    this.redis.destroy()
  }

  async id(props: IdOptions): Promise<string> {
    // move to js
    return this.redis.loadAndEvalScript(
      'id',
      SCRIPTS.id,
      0,
      [],
      [JSON.stringify(props)]
    )
  }

  async set(props: SetOptions) {
    return set(this, props)
  }

  async get(props: GetOptions) {
    return get(this, props)
  }

  async observe(props: GetOptions) {
    return observe(this, props)
  }

  async updateSchema(props: SchemaOptions, retry?: number) {
    retry = retry || 0

    if (!props.types) {
      props.types = {}
    }

    const newSchema = newSchemaDefinition(this.schema, <Schema>props)
    try {
      const updated = await this.redis.loadAndEvalScript(
        'update-schema',
        SCRIPTS['update-schema'],
        0,
        [],
        [`${this.loglevel}:${this.clientId}`, JSON.stringify(newSchema)]
      )

      if (updated) {
        this.schema = JSON.parse(updated)
      }
    } catch (e) {
      console.error('Error updating schema', e.stack)
      if (
        e.stack.includes(
          'SHA mismatch: trying to update an older schema version, please re-fetch and try again'
        )
      ) {
        if (retry >= MAX_SCHEMA_UPDATE_RETRIES) {
          throw new Error(
            `Unable to update schema after ${MAX_SCHEMA_UPDATE_RETRIES} attempts`
          )
        }

        await this.getSchema()
        await this.updateSchema(props, retry + 1)
      } else {
        throw e
      }
    }
  }

  async getSchema() {
    return getSchema(this)
  }

  async modify(opts: ModifyOptions, retry: number = 0): Promise<ModifyResult> {
    if (!this.schema || !this.schema.sha) {
      await this.getSchema()
    }

    try {
      return await this.redis.loadAndEvalScript(
        'modify',
        SCRIPTS.modify,
        0,
        [],
        [
          `${this.loglevel}:${this.clientId}`,
          this.schema.sha,
          JSON.stringify(opts)
        ],
        { batchingEnabled: true }
      )
    } catch (e) {
      console.error('Error running modify', e)
      if (
        e.stack &&
        e.stack.includes(
          'SHA mismatch: trying to update an older schema version, please re-fetch and try again'
        )
      ) {
        if (retry >= MAX_SCHEMA_UPDATE_RETRIES) {
          throw new Error(
            `Unable to update schema after ${MAX_SCHEMA_UPDATE_RETRIES} attempts`
          )
        }

        await this.getSchema()
        await this.modify(opts, retry + 1)
      } else {
        throw e
      }
    }
  }

  async fetch(opts: GetOptions): Promise<GetResult> {
    const str = await this.redis.loadAndEvalScript(
      'fetch',
      SCRIPTS.fetch,
      0,
      [],
      [`${this.loglevel}:${this.clientId}`, JSON.stringify(opts)]
    )

    return JSON.parse(str)
  }

  async getTypeFromId(id: Id) {
    return getTypeFromId(this, id)
  }

  async delete(props: DeleteOptions) {
    let hierarchy = true
    let id: string
    if (typeof props == 'object') {
      id = props.$id
      if (props.$hierarchy === false) {
        hierarchy = false
      }
    } else {
      id = props
    }
    return deleteItem(this, id, hierarchy)
  }
}

export function connect(
  opts: ConnectOptions | (() => Promise<ConnectOptions>),
  selvaOpts?: SelvaOptions
): SelvaClient {
  return new SelvaClient(opts, selvaOpts)
}
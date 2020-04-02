import { GetOptions } from '@saulx/selva'
import { createHash } from 'crypto'
import { updateQueries as updateNowQueries } from './now'
import { QuerySubscription } from './'
import SubscriptionManager from './index'

const sendUpdate = async (
  subscriptionManager: SubscriptionManager,
  subscriptionId: string,
  deleteOp: boolean = false
) => {
  if (!subscriptionManager.pub) {
    return
  }
  const cache = `___selva_cache`
  const subscription = subscriptionManager.subscriptions[subscriptionId]

  if (!subscription) {
    console.error(`Cannot find subscription on server ${subscriptionId}`)
    return
  }

  if (deleteOp) {
    const event = JSON.stringify({ type: 'delete' })
    await Promise.all([
      subscriptionManager.client.redis.hset(cache, subscriptionId, event),
      subscriptionManager.client.redis.hset(
        cache,
        subscriptionId + '_version',
        ''
      )
    ])
    await subscriptionManager.client.redis.publish(subscriptionId, '')
    return
  }

  const getOptions = subscriptionManager.subscriptions[subscriptionId].get

  const payload = await subscriptionManager.client.get(
    Object.assign({}, getOptions, {
      $includeMeta: true
    })
  )

  // handle refs -- add this somewhere else
  const refs = payload.$meta.$refs
  delete subscriptionManager.refsById[getOptions.$id]
  let hasRefs = false
  const newRefs: Record<string, string> = {}
  for (const refSource in refs) {
    hasRefs = true
    const refTargets = refs[refSource]
    newRefs[refSource] = refTargets
  }
  subscriptionManager.refsById[getOptions.$id] = newRefs
  if (hasRefs) {
    // FIXME: very slow to do this all the time for everything :/
    console.log('WARNING UPDATING ALL SUBS BECAUSE OF REF CHANGE (SLOW!)')
    // will go into an endless loop scince creation of subscriptions call sendupdate
    // subscriptionManager.updateSubscriptionData(true)
  }

  // handle query
  if (payload.$meta.query) {
    subscriptionManager.queries[subscriptionId] = <QuerySubscription[]>(
      payload.$meta.query
    )
    for (const queryMeta of payload.$meta.query) {
      if (queryMeta.time) {
        updateNowQueries(subscriptionManager, {
          subId: subscriptionId,
          nextRefresh: queryMeta.time.nextRefresh
        })
      }
    }
  }

  // clean up $meta before we send it to the client
  // if nested meta remove them
  delete payload.$meta

  // dont encode/decode as many times
  const resultStr = JSON.stringify({ type: 'update', payload })
  const currentHash = subscription.version
  const hashingFn = createHash('sha256')
  hashingFn.update(resultStr)
  const newHash = hashingFn.digest('hex')

  // de-duplicate events
  // with this we can avoid sending events where nothing changed upon reconnection
  // both for queries and for gets by id
  if (currentHash && currentHash === newHash) {
    return
  }

  // change all this result hash
  subscription.version = newHash

  // update cache

  // also do this on intial
  await Promise.all([
    subscriptionManager.client.redis.hset(cache, subscriptionId, resultStr),
    subscriptionManager.client.redis.hset(
      cache,
      subscriptionId + '_version',
      newHash
    )
  ])

  subscriptionManager.client.redis.publish(subscriptionId, newHash)
}

export default sendUpdate

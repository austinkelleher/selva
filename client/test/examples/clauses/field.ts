import test from 'ava'
import { connect } from '@saulx/selva'
import { start } from '@saulx/selva-server'
import '../../assertions'
import { wait } from '../../assertions'
// @ts-ignore suppressing module can only be default-imported using the 'esModuleInterop' flag
import getPort from 'get-port' 

import { schema } from '../_schema'
import { setDataSet } from '../_dataSet'

let srv
let port

test.before(async t => {
  port = await getPort()
  srv = await start({ port })
  await wait(500)
  const client = connect({ port: port })
  await client.updateSchema(schema)
  await client.destroy()
})

test.after(async _t => {
  const client = connect({ port })
  await client.delete('root')
  await client.destroy()
  await srv.destroy()
})

test.serial('$field', async t => {
  const client = connect({ port: port })

  await setDataSet(client)

  t.deepEqual(await client.get({
    $id: 'mo2001ASpaceOdyssey',
    directedBy: { $field: 'director' }
  }), { directedBy: 'Stanley Kubrick' })

  t.deepEqual(await client.get({
    $id: 'mo2001ASpaceOdyssey',
    ratio: { $field: 'technicalData.aspectRatio' }
  }), { ratio: '2.20:1' })

  t.deepEqual(await client.get({
    $id: 'mo2001ASpaceOdyssey',
    englishTitle: { $field: 'title.en' }
  }), { englishTitle: '2001: A Space Odyssey' })
})

test.serial('$field:Array<string>', async t => {
  const client = connect({ port: port })

  await setDataSet(client)

  t.deepEqual(await client.get({
    $id: 'mo2001ASpaceOdyssey',
    by: { $field: ['producer', 'director'] }
  }), { by: 'Stanley Kubrick' })
})

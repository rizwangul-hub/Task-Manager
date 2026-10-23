import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useMongoAuthState } from '../src/services/mongoAuthState.js';

const createAuthModel = () => {
  const records = new Map();
  return {
    records,
    find() {
      return { lean: async () => [...records.values()] };
    },
    findOne({ key }) {
      return { lean: async () => records.get(key) || null };
    },
    async updateOne({ key }, update) {
      records.set(key, update.$set);
    },
    async deleteOne({ key }) {
      records.delete(key);
    }
  };
};

test('Mongo-backed Baileys auth keys and credentials persist across a local filesystem restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task-manager-wa-auth-'));
  const authModel = createAuthModel();
  try {
    const firstState = await useMongoAuthState(join(root, 'first'), { authModel });
    firstState.state.creds.marker = 'persisted-credentials';
    await firstState.saveCreds();
    await firstState.state.keys.set({
      session: {
        'participant-lid.0': {
          registrationId: 7,
          identityKey: Buffer.from('signal-session')
        }
      }
    });

    const restartedState = await useMongoAuthState(join(root, 'restarted'), { authModel });
    const restoredKeys = await restartedState.state.keys.get('session', ['participant-lid.0']);

    assert.equal(restartedState.state.creds.marker, 'persisted-credentials');
    assert.deepEqual(restoredKeys['participant-lid.0'], {
      registrationId: 7,
      identityKey: Buffer.from('signal-session')
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Mongo auth persistence failures are surfaced to Baileys instead of silently ignored', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task-manager-wa-auth-error-'));
  const authModel = createAuthModel();
  authModel.updateOne = async () => {
    throw new Error('MongoDB persistence unavailable');
  };

  try {
    const authState = await useMongoAuthState(root, { authModel });
    await assert.rejects(
      authState.state.keys.set({ session: { 'participant-lid.0': { registrationId: 7 } } }),
      /MongoDB persistence unavailable/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { readFile, writeFile, unlink, mkdir, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import { WhatsAppAuth } from '../models/whatsappAuth.model.js';

/**
 * MongoDB-backed persistent auth state for Baileys.
 * Automatically mirrors all credentials and Signal keys between MongoDB Atlas
 * and a local folder cache, ensuring sessions persist across container restarts on Render.
 */
export const useMongoAuthState = async (folderPath, { authModel = WhatsAppAuth } = {}) => {
  const folder = resolve(folderPath || './auth_info_baileys');
  await mkdir(folder, { recursive: true, mode: 0o700 });

  const savedDocs = await authModel.find().lean();
  const validKeys = new Set(savedDocs.map((d) => d.key));

  for (const doc of savedDocs) {
    try {
      await writeFile(join(folder, doc.key), doc.value, { encoding: 'utf-8' });
    } catch {}
  }

  // Remove any stale local files on disk that no longer exist in MongoDB
  try {
    const localFiles = await readdir(folder);
    for (const file of localFiles) {
      if (file.endsWith('.json') && !validKeys.has(file)) {
        await unlink(join(folder, file)).catch(() => {});
      }
    }
  } catch {}

  const fixFileName = (file) => file?.replace(/\//g, '__')?.replace(/:/g, '-');

  const writeData = async (data, file) => {
    const fixed = fixFileName(file);
    const filePath = join(folder, fixed);
    const stringified = JSON.stringify(data, BufferJSON.replacer);
    await writeFile(filePath, stringified, 'utf-8');
    await authModel.updateOne(
      { key: fixed },
      { $set: { key: fixed, value: stringified } },
      { upsert: true }
    );
  };

  const readData = async (file) => {
    const fixed = fixFileName(file);
    const filePath = join(folder, fixed);
    try {
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw, BufferJSON.reviver);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const doc = await authModel.findOne({ key: fixed }).lean();
    return doc?.value ? JSON.parse(doc.value, BufferJSON.reviver) : null;
  };

  const removeData = async (file) => {
    const fixed = fixFileName(file);
    const filePath = join(folder, fixed);
    try {
      await unlink(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await authModel.deleteOne({ key: fixed });
  };

  const creds = (await readData('creds.json')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}.json`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const file = `${category}-${id}.json`;
              tasks.push(value ? writeData(value, file) : removeData(file));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: async () => {
      return writeData(creds, 'creds.json');
    }
  };
};

export const clearMongoAuthState = async () => {
  try {
    await WhatsAppAuth.deleteMany({});
  } catch {}
};

import { readFile, writeFile, unlink, mkdir, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import { WhatsAppAuth } from '../models/whatsappAuth.model.js';

/**
 * MongoDB-backed persistent auth state for Baileys.
 * Automatically mirrors all credentials and Signal keys between MongoDB Atlas
 * and a local folder cache, ensuring sessions persist across container restarts on Render.
 */
export const useMongoAuthState = async (folderPath) => {
  const folder = resolve(folderPath || './auth_info_baileys');
  await mkdir(folder, { recursive: true, mode: 0o700 });

  // 1. On startup: restore from MongoDB if local folder is missing creds.json
  const hasLocalCreds = await stat(join(folder, 'creds.json')).then(() => true).catch(() => false);

  if (!hasLocalCreds) {
    try {
      const savedDocs = await WhatsAppAuth.find().lean();
      if (savedDocs.length > 0) {
        for (const doc of savedDocs) {
          try {
            await writeFile(join(folder, doc.key), doc.value, 'utf-8');
          } catch {}
        }
      }
    } catch {}
  } else {
    // If local creds exist, sync them to MongoDB so MongoDB is up to date
    try {
      const files = await readdir(folder);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const content = await readFile(join(folder, file), 'utf-8');
            await WhatsAppAuth.updateOne(
              { key: file },
              { $set: { key: file, value: content } },
              { upsert: true }
            );
          } catch {}
        }
      }
    } catch {}
  }

  const fixFileName = (file) => file?.replace(/\//g, '__')?.replace(/:/g, '-');

  const writeData = async (data, file) => {
    const fixed = fixFileName(file);
    const filePath = join(folder, fixed);
    const stringified = JSON.stringify(data, BufferJSON.replacer);
    try {
      await writeFile(filePath, stringified, 'utf-8');
    } catch {}

    WhatsAppAuth.updateOne(
      { key: fixed },
      { $set: { key: fixed, value: stringified } },
      { upsert: true }
    ).catch(() => {});
  };

  const readData = async (file) => {
    const fixed = fixFileName(file);
    const filePath = join(folder, fixed);
    try {
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw, BufferJSON.reviver);
    } catch {
      try {
        const doc = await WhatsAppAuth.findOne({ key: fixed }).lean();
        if (doc?.value) {
          try {
            await writeFile(filePath, doc.value, 'utf-8');
          } catch {}
          return JSON.parse(doc.value, BufferJSON.reviver);
        }
      } catch {}
      return null;
    }
  };

  const removeData = async (file) => {
    const fixed = fixFileName(file);
    const filePath = join(folder, fixed);
    try {
      await unlink(filePath);
    } catch {}
    WhatsAppAuth.deleteOne({ key: fixed }).catch(() => {});
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

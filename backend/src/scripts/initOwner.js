import mongoose from 'mongoose';
import { env, validateEnv } from '../config/env.js';
import { connectDB, disconnectDB } from '../config/db.js';
import { User, USER_ROLES } from '../models/user.model.js';
import { Task } from '../models/task.model.js';
import { Project } from '../models/project.model.js';
import { logger } from '../utils/logger.js';

// Parse CLI flags (--email=..., --password=..., --name=...)
const getArgValue = (argName) => {
  const prefix = `--${argName}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.substring(prefix.length) : null;
};

export const initOwner = async () => {
  validateEnv();

  if (!env.MONGODB_URI) {
    logger.error('CRITICAL: Cannot initialize owner account. MONGODB_URI is not set in environment.');
    process.exit(1);
  }

  try {
    await connectDB();

    if (mongoose.connection.readyState !== 1) {
      logger.error('CRITICAL: MongoDB is not connected. Owner initialization aborted.');
      process.exit(1);
    }

    const email = (
      getArgValue('email') ||
      env.OWNER.email ||
      env.INITIAL_ADMIN.email ||
      ''
    ).toLowerCase().trim();

    const rawPassword =
      getArgValue('password') ||
      env.OWNER.password ||
      env.INITIAL_ADMIN.password ||
      '';

    const name = (
      getArgValue('name') ||
      env.OWNER.name ||
      env.INITIAL_ADMIN.name ||
      'Workspace Owner'
    ).trim();

    if (!email) {
      logger.error('Owner email is required. Provide via --email=<email> or OWNER_EMAIL in .env.');
      process.exit(1);
    }

    if (!rawPassword || rawPassword.length < 8) {
      logger.error('Owner password must be at least 8 characters long. Provide via --password=<password> or OWNER_PASSWORD in .env.');
      process.exit(1);
    }

    // Check existing owner
    let owner = await User.findOne({ email });

    if (owner) {
      logger.info(`Owner account '${email}' already exists. Updating credentials and ensuring active status...`);
      owner.passwordHash = await User.hashPassword(rawPassword);
      owner.role = USER_ROLES.ADMIN;
      owner.name = name;
      owner.isActive = true;
      await owner.save();
      logger.info(`Owner account '${email}' verified and updated successfully.`);
    } else {
      logger.info(`Creating single private workspace owner account for '${email}'...`);
      const passwordHash = await User.hashPassword(rawPassword);
      owner = await User.create({
        name,
        email,
        passwordHash,
        role: USER_ROLES.ADMIN,
        isActive: true
      });
      logger.info(`Single workspace owner account '${email}' created successfully.`);
    }

    // Backward compatibility: link any legacy unassigned projects & tasks to the owner
    const [migratedProjects, migratedTasks] = await Promise.all([
      Project.updateMany(
        { $or: [{ manager: { $exists: false } }, { manager: null }] },
        { $set: { manager: owner._id, members: [owner._id] } }
      ),
      Task.updateMany(
        { $or: [{ creator: { $exists: false } }, { creator: null }] },
        { $set: { creator: owner._id, assignees: [owner._id] } }
      )
    ]);

    if (migratedProjects.modifiedCount > 0 || migratedTasks.modifiedCount > 0) {
      logger.info(`Backward compatibility: linked ${migratedProjects.modifiedCount} legacy projects and ${migratedTasks.modifiedCount} legacy tasks to owner.`);
    }
  } catch (error) {
    logger.error('Single-user owner initialization failed:', error);
    process.exit(1);
  } finally {
    await disconnectDB();
    process.exit(0);
  }
};

// Execute if run directly via CLI
if (process.argv[1]?.includes('initOwner.js') || process.argv[1]?.includes('createAdmin.js')) {
  initOwner();
}

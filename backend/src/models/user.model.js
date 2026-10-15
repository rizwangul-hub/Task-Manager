import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export const USER_ROLES = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  MEMBER: 'Member'
};

Object.defineProperty(USER_ROLES, 'EMPLOYEE', {
  value: USER_ROLES.MEMBER,
  enumerable: false
});

const LEGACY_ROLES = {
  ADMIN: USER_ROLES.ADMIN,
  MANAGER: USER_ROLES.MANAGER,
  EMPLOYEE: USER_ROLES.MEMBER
};

export const normalizeUserRole = (role) => LEGACY_ROLES[role] || role;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'User name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters']
    },
    email: {
      type: String,
      required: [true, 'User email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please provide a valid email address'
      ]
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
      select: false // Exclude from queries by default
    },
    avatar: {
      type: String,
      default: '',
      trim: true
    },
    phone: {
      type: String,
      default: '',
      trim: true,
      maxlength: [32, 'Phone number cannot exceed 32 characters']
    },
    whatsappNumber: {
      type: String,
      trim: true,
      default: null,
      maxlength: [32, 'WhatsApp number cannot exceed 32 characters']
    },
    role: {
      type: String,
      enum: {
        values: Object.values(USER_ROLES),
        message: '{VALUE} is not a valid role'
      },
      default: USER_ROLES.MEMBER
    },
    isActive: {
      type: Boolean,
      default: true
    },
    lastLogin: {
      type: Date,
      default: null
    },
    notificationPreferences: {
      emailNotifications: { type: Boolean, default: true },
      taskAssigned: { type: Boolean, default: true },
      taskStatusChanged: { type: Boolean, default: true },
      taskDueDate: { type: Boolean, default: true },
      taskComments: { type: Boolean, default: true },
      overdueReminders: { type: Boolean, default: true }
    }
  },
  {
    timestamps: true
  }
);

userSchema.pre('init', function (document) {
  document.role = normalizeUserRole(document.role);
});

// Indexes
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ phone: 1 }, { sparse: true });

/**
 * Compare plain text password with stored bcrypt hash
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.passwordHash) {
    throw new Error('Password hash is missing on user model instance.');
  }
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

/**
 * Static method to hash a raw password securely
 */
userSchema.statics.hashPassword = async function (rawPassword) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(rawPassword, salt);
};

/**
 * Exclude sensitive fields when serializing user to JSON
 */
userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.passwordHash;
  delete user.__v;
  return user;
};

export const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;

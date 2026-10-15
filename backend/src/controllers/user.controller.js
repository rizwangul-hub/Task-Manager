import { User, USER_ROLES, normalizeUserRole } from '../models/user.model.js';
import { AppError } from '../middleware/errorHandler.js';

export const userController = {
  /**
   * List and search users with pagination and role filters
   * GET /api/users
   */
  getUsers: async (req, res, next) => {
    try {
      const query = {};
      if (req.user.role === USER_ROLES.MEMBER) {
        query._id = req.user._id;
      } else {
        const filters = [];
        if (req.query.status === 'active') filters.push({ isActive: true });
        if (req.query.status === 'inactive') filters.push({ isActive: false });

        if (typeof req.query.role === 'string') {
          const role = normalizeUserRole(req.query.role);
          if (Object.values(USER_ROLES).includes(role)) {
            const legacyRole = {
              [USER_ROLES.ADMIN]: 'ADMIN',
              [USER_ROLES.MANAGER]: 'MANAGER',
              [USER_ROLES.MEMBER]: 'EMPLOYEE'
            }[role];
            filters.push({ role: { $in: [role, legacyRole] } });
          }
        }

        if (typeof req.query.search === 'string' && req.query.search.trim()) {
          const search = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          filters.push({
            $or: [
              { name: { $regex: search, $options: 'i' } },
              { email: { $regex: search, $options: 'i' } }
            ]
          });
        }
        if (filters.length) query.$and = filters;
      }

      const [users, total] = await Promise.all([
        User.find(query).sort({ name: 1 }).limit(100),
        User.countDocuments(query)
      ]);
      const userList = users.map((user) => user.toJSON());

      res.status(200).json({
        status: 'success',
        data: {
          users: userList,
          pagination: {
            page: 1,
            limit: 100,
            total,
            pages: Math.ceil(total / 100) || 1
          }
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get single user by ID
   * GET /api/users/:id
   */
  getUserById: async (req, res, next) => {
    try {
      const user = await User.findById(req.params.id);
      if (!user) {
        return next(new AppError('User not found.', 404));
      }
      if (req.user.role === USER_ROLES.MEMBER && user._id.toString() !== req.user._id.toString()) {
        return next(new AppError('Access forbidden: Members can only view their own user profile.', 403));
      }

      res.status(200).json({
        status: 'success',
        data: { user: user.toJSON() }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Create a member account. Managers may only create Member roles.
   * POST /api/users
   */
  createUser: async (req, res, next) => {
    const body = req.body || {};
    const { name, email, password, phone, whatsappNumber, avatar } = body;
    const requestedRole = body.role || USER_ROLES.MEMBER;

    if (typeof name !== 'string' || !name.trim() ||
        typeof email !== 'string' || !email.trim() ||
        typeof password !== 'string' || !password) {
      return next(new AppError('Name, email, and password are required.', 400));
    }
    if ((phone !== undefined && typeof phone !== 'string') ||
        (whatsappNumber !== undefined && whatsappNumber !== null && typeof whatsappNumber !== 'string') ||
        (avatar !== undefined && typeof avatar !== 'string')) {
      return next(new AppError('Phone, WhatsApp number, and avatar values must be strings.', 400));
    }
    if (password.length < 8) {
      return next(new AppError('Password must be at least 8 characters long.', 400));
    }
    if (!Object.values(USER_ROLES).includes(requestedRole)) {
      return next(new AppError('A valid user role is required.', 400));
    }
    if (req.user.role === USER_ROLES.MANAGER && requestedRole !== USER_ROLES.MEMBER) {
      return next(new AppError('Managers can create Member accounts only.', 403));
    }

    try {
      const normalizedEmail = email.toLowerCase().trim();
      if (await User.exists({ email: normalizedEmail })) {
        return next(new AppError('Email address is already in use.', 409));
      }

      const user = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        passwordHash: await User.hashPassword(password),
        role: requestedRole,
        phone: phone || '',
        whatsappNumber: typeof whatsappNumber === 'string' && whatsappNumber.trim()
          ? whatsappNumber.trim()
          : null,
        avatar: avatar || ''
      });

      res.status(201).json({
        status: 'success',
        message: 'User account created successfully.',
        data: { user: user.toJSON() }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Update user details (Self only, role changes disabled)
   * PUT /api/users/:id
   */
  updateUser: async (req, res, next) => {
    const { id } = req.params;
    const { name, email, phone, whatsappNumber, avatar } = req.body || {};

    try {
      if (req.user._id.toString() !== id) {
        return next(new AppError('Access forbidden: You cannot modify other user accounts.', 403));
      }

      const user = await User.findById(id);
      if (!user) {
        return next(new AppError('User not found.', 404));
      }

      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
          return next(new AppError('Name must be a non-empty string.', 400));
        }
        user.name = name.trim();
      }
      if (phone !== undefined) {
        if (typeof phone !== 'string') return next(new AppError('Phone must be a string.', 400));
        user.phone = phone.trim();
      }
      if (whatsappNumber !== undefined) {
        if (whatsappNumber !== null && typeof whatsappNumber !== 'string') {
          return next(new AppError('WhatsApp number must be a string or null.', 400));
        }
        user.whatsappNumber = typeof whatsappNumber === 'string' && whatsappNumber.trim()
          ? whatsappNumber.trim()
          : null;
      }
      if (avatar !== undefined) {
        if (typeof avatar !== 'string') return next(new AppError('Avatar must be a string.', 400));
        user.avatar = avatar.trim();
      }

      if (email !== undefined) {
        if (typeof email !== 'string' || !email.trim()) {
          return next(new AppError('Email must be a non-empty string.', 400));
        }
        const normalizedEmail = email.toLowerCase().trim();
        if (normalizedEmail !== user.email) {
          const duplicate = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
          if (duplicate) {
            return next(new AppError('Email address is already in use by another account.', 409));
          }
          user.email = normalizedEmail;
        }
      }

      await user.save();

      res.status(200).json({
        status: 'success',
        message: 'User profile updated successfully.',
        data: { user: user.toJSON() }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Activate or Deactivate user account - Disabled in single-user workspace
   * PATCH /api/users/:id/status
   */
  setUserStatus: async (req, res, next) => {
    return next(new AppError('Single-user private workspace: deactivating the workspace owner account is disabled.', 403));
  },

  /**
   * Reset user password (Workspace owner only)
   * POST /api/users/:id/reset-password
   */
  resetPassword: async (req, res, next) => {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (req.user._id.toString() !== id) {
      return next(new AppError('Access forbidden: You can only change your own password.', 403));
    }

    if (!newPassword || newPassword.length < 8) {
      return next(new AppError('New password must be at least 8 characters long.', 400));
    }

    try {
      const user = await User.findById(id).select('+passwordHash');
      if (!user) {
        return next(new AppError('User not found.', 404));
      }

      user.passwordHash = await User.hashPassword(newPassword);
      await user.save();

      res.status(200).json({
        status: 'success',
        message: 'Password successfully reset.'
      });
    } catch (error) {
      next(error);
    }
  }
};

export default userController;

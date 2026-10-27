import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const uri = 'mongodb+srv://mern:stack@cluster0.a2wsoz3.mongodb.net/task-manager?retryWrites=true&w=majority';

async function seedAdmins() {
  await mongoose.connect(uri);
  console.log('Connected to MongoDB.');

  const newAdmins = [
    {
      name: 'Kamran Ijaz',
      email: 'kamran@gmail.com',
      password: 'kamran123',
      role: 'Admin',
      phone: '+44 7880 716972',
      whatsappNumber: '447880716972'
    },
    {
      name: 'Khurshid Anwar',
      email: 'khurshid@gmail.com',
      password: 'khurshid123',
      role: 'Admin',
      phone: '+92 345 9028996',
      whatsappNumber: '923459028996'
    },
    {
      name: 'Rizwan',
      email: 'rizwan@gmail.com',
      password: 'rizwan123',
      role: 'Admin',
      phone: '+92 317 9500901',
      whatsappNumber: '923179500901'
    }
  ];

  const db = mongoose.connection.db;
  const usersCollection = db.collection('users');

  for (const admin of newAdmins) {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(admin.password, salt);

    const filter = { email: admin.email.toLowerCase().trim() };
    const updateDoc = {
      $set: {
        name: admin.name,
        email: admin.email.toLowerCase().trim(),
        passwordHash: passwordHash,
        role: admin.role,
        phone: admin.phone,
        whatsappNumber: admin.whatsappNumber,
        isActive: true,
        notificationPreferences: {
          emailNotifications: true,
          taskAssigned: true,
          taskStatusChanged: true,
          taskDueDate: true,
          taskComments: true,
          overdueReminders: true
        },
        updatedAt: new Date()
      },
      $setOnInsert: {
        createdAt: new Date(),
        avatar: '',
        lastLogin: null
      }
    };

    const res = await usersCollection.updateOne(filter, updateDoc, { upsert: true });
    console.log(`Processed: ${admin.name} (${admin.email}) -> ${res.upsertedCount ? 'Created' : 'Updated'}`);
  }

  const allUsers = await usersCollection.find({}).toArray();
  console.log(`\n--- Current Users in Database (${allUsers.length}) ---`);
  allUsers.forEach((u, i) => {
    console.log(`${i + 1}. ${u.name} (${u.email}) - Role: ${u.role} - Active: ${u.isActive}`);
  });

  await mongoose.disconnect();
  console.log('\nDatabase connection closed.');
}

seedAdmins().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});

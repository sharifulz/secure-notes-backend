/**
 * Secure Note-Taking Application
 * MongoDB Database Setup & Sample Data
 *
 * Run:
 * mongosh secure_notes_setup.js
 *
 * Database: secure_notes_db
 * Collections: users, notes, posts
 */

// ============================================
// 1. SELECT DATABASE
// ============================================

const database = db.getSiblingDB("secure_notes_db");

print("Using database: secure_notes_db");

// ============================================
// 2. CREATE COLLECTIONS
// ============================================

["users", "notes", "posts"].forEach((name) => {
  const exists = database.getCollectionNames().includes(name);

  if (!exists) {
    database.createCollection(name);
    print("Created collection: " + name);
  } else {
    print("Collection already exists: " + name);
  }
});

// ============================================
// 3. CREATE INDEXES
// ============================================

// USERS
// Login and unique email
database.users.createIndex(
  { email: 1 },
  {
    unique: true,
    name: "idx_users_email_unique"
  }
);

// Admin user listing with pagination
database.users.createIndex(
  { createdAt: -1, _id: -1 },
  { name: "idx_users_created_id" }
);

// NOTES
// Retrieve a user's notes sorted by newest
database.notes.createIndex(
  { ownerId: 1, createdAt: -1, _id: -1 },
  { name: "idx_notes_owner_created_id" }
);

// Admin listing of everyone's notes
database.notes.createIndex(
  { createdAt: -1, _id: -1 },
  { name: "idx_notes_created_id" }
);

// POSTS
// Retrieve user posts using $lookup
database.posts.createIndex(
  { authorId: 1, createdAt: -1, _id: -1 },
  { name: "idx_posts_author_created_id" }
);

print("All required indexes created.");

// ============================================
// 4. SAMPLE IDs
// ============================================

const adminId  = ObjectId("690000000000000000000001");
const rahimId  = ObjectId("690000000000000000000002");
const karimId  = ObjectId("690000000000000000000003");
const nabilaId = ObjectId("690000000000000000000004");

const seedDate = ISODate("2026-11-13T04:00:00.000Z");

// ============================================
// 5. INSERT SAMPLE USERS
// ============================================

// These are sample accounts only.
//
// Password hashes are intentionally not
// generated in the database script.
//
// Before testing login, use the Node.js
// seed-password script provided below to
// generate valid bcrypt hashes.

const users = [
  {
    _id: adminId,
    name: "System Admin",
    email: "admin@notes.test",
    role: "ADMIN",
    interests: ["technology", "security"]
  },
  {
    _id: rahimId,
    name: "Rahim Ahmed",
    email: "rahim@notes.test",
    role: "USER",
    interests: ["chess", "reading", "coding"]
  },
  {
    _id: karimId,
    name: "Karim Hasan",
    email: "karim@notes.test",
    role: "USER",
    interests: ["chess", "football", "coding"]
  },
  {
    _id: nabilaId,
    name: "Nabila Islam",
    email: "nabila@notes.test",
    role: "USER",
    interests: ["reading", "music", "coding"]
  }
];

users.forEach((user) => {
  database.users.updateOne(
    { _id: user._id },
    {
      $setOnInsert: {
        ...user,
        passwordHash: null,
        createdAt: seedDate,
        updatedAt: seedDate
      }
    },
    { upsert: true }
  );
});

print("Sample users inserted.");

// ============================================
// 6. INSERT SAMPLE NOTES
// ============================================

const notes = [
  {
    _id: ObjectId("690000000000000000000101"),
    ownerId: rahimId,
    title: "MongoDB Indexing",
    content: "Learn compound indexes and query optimization."
  },
  {
    _id: ObjectId("690000000000000000000102"),
    ownerId: rahimId,
    title: "JWT Authentication",
    content: "Implement JWT authentication in Express."
  },
  {
    _id: ObjectId("690000000000000000000103"),
    ownerId: karimId,
    title: "Backend Development",
    content: "Practice Node.js and TypeScript."
  },
  {
    _id: ObjectId("690000000000000000000104"),
    ownerId: karimId,
    title: "Aggregation Pipeline",
    content: "Practice $match, $group, and $lookup."
  },
  {
    _id: ObjectId("690000000000000000000105"),
    ownerId: nabilaId,
    title: "React Notes",
    content: "Build a simple notes management UI."
  },
  {
    _id: ObjectId("690000000000000000000106"),
    ownerId: adminId,
    title: "Admin Checklist",
    content: "Review roles, indexes, and API security."
  }
];

notes.forEach((note, index) => {
  const createdAt = new Date(
    seedDate.getTime() + index * 60000
  );

  database.notes.updateOne(
    { _id: note._id },
    {
      $setOnInsert: {
        ...note,
        createdAt,
        updatedAt: createdAt
      }
    },
    { upsert: true }
  );
});

print("Sample notes inserted.");

// ============================================
// 7. INSERT SAMPLE POSTS
// ============================================

const posts = [
  {
    _id: ObjectId("690000000000000000000201"),
    authorId: rahimId,
    title: "Learning MongoDB",
    content: "MongoDB is a document database."
  },
  {
    _id: ObjectId("690000000000000000000202"),
    authorId: rahimId,
    title: "Understanding Indexes",
    content: "Indexes can speed up database queries."
  },
  {
    _id: ObjectId("690000000000000000000203"),
    authorId: karimId,
    title: "My Coding Journey",
    content: "I am learning Node.js and Express."
  },
  {
    _id: ObjectId("690000000000000000000204"),
    authorId: nabilaId,
    title: "React Development",
    content: "React is useful for frontend applications."
  },
  {
    _id: ObjectId("690000000000000000000205"),
    authorId: adminId,
    title: "Application Security",
    content: "Always validate authorization on the server."
  }
];

posts.forEach((post, index) => {
  const createdAt = new Date(
    seedDate.getTime() + index * 60000
  );

  database.posts.updateOne(
    { _id: post._id },
    {
      $setOnInsert: {
        ...post,
        createdAt,
        updatedAt: createdAt
      }
    },
    { upsert: true }
  );
});

print("Sample posts inserted.");

// ============================================
// 8. QUERY: GET ALL USERS (PAGINATION)
// ============================================

const page = 1;
const limit = 10;
const skip = (page - 1) * limit;

print("\n--- PAGINATED USERS ---");

printjson(
  database.users.find(
    {},
    { passwordHash: 0 }
  )
    .sort({ createdAt: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .toArray()
);

// ============================================
// 9. QUERY: GET OWN NOTES
// ============================================

print("\n--- RAHIM'S NOTES ---");

printjson(
  database.notes.find({
    ownerId: rahimId
  })
    .sort({ createdAt: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .toArray()
);

// ============================================
// 10. QUERY: GET SPECIFIC NOTE
// ============================================

print("\n--- SINGLE NOTE ---");

printjson(
  database.notes.findOne({
    _id: ObjectId("690000000000000000000101"),
    ownerId: rahimId
  })
);

// ============================================
// 11. QUERY: ADMIN VIEW ALL NOTES
// ============================================

print("\n--- ALL NOTES (ADMIN) ---");

printjson(
  database.notes.find({})
    .sort({ createdAt: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .toArray()
);

// ============================================
// 12. AGGREGATION SCENARIO 1
// GROUP USERS BY INTERESTS
// EXACTLY ONE aggregate() CALL
// ============================================

print("\n--- USERS GROUPED BY INTERESTS ---");

const groupedByInterests = database.users.aggregate([
  {
    $unwind: "$interests"
  },
  {
    $group: {
      _id: "$interests",
      totalUsers: { $sum: 1 },
      users: {
        $push: {
          userId: "$_id",
          name: "$name",
          email: "$email"
        }
      }
    }
  },
  {
    $sort: { _id: 1 }
  },
  {
    $facet: {
      data: [
        { $skip: skip },
        { $limit: limit }
      ],
      metadata: [
        { $count: "total" }
      ]
    }
  }
]).toArray();

printjson(groupedByInterests);

// ============================================
// 13. AGGREGATION SCENARIO 2
// USER POSTS USING $lookup
// SINGLE AGGREGATION PIPELINE
// ============================================

print("\n--- RAHIM'S POSTS USING LOOKUP ---");

const userPosts = database.users.aggregate([
  {
    $match: {
      _id: rahimId
    }
  },
  {
    $lookup: {
      from: "posts",
      localField: "_id",
      foreignField: "authorId",
      pipeline: [
        {
          $sort: {
            createdAt: -1,
            _id: -1
          }
        },
        {
          $facet: {
            data: [
              { $skip: skip },
              { $limit: limit },
              {
                $project: {
                  title: 1,
                  content: 1,
                  createdAt: 1
                }
              }
            ],
            metadata: [
              { $count: "total" }
            ]
          }
        }
      ],
      as: "postResults"
    }
  },
  {
    $project: {
      name: 1,
      email: 1,
      postResults: {
        $arrayElemAt: ["$postResults", 0]
      }
    }
  }
]).toArray();

printjson(userPosts);

// ============================================
// 14. INDEX VERIFICATION
// ============================================

print("\n--- USERS INDEXES ---");
printjson(database.users.getIndexes());

print("\n--- NOTES INDEXES ---");
printjson(database.notes.getIndexes());

print("\n--- POSTS INDEXES ---");
printjson(database.posts.getIndexes());

// ============================================
// 15. QUERY PERFORMANCE
// ============================================

print("\n--- NOTES QUERY EXPLAIN ---");

printjson(
  database.notes.find({
    ownerId: rahimId
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(10)
    .explain("executionStats")
);

// ============================================
// 16. FINAL SUMMARY
// ============================================

print("\n===== DATABASE SETUP COMPLETE =====");

print("Database: secure_notes_db");

print("Users: " + database.users.countDocuments({}));
print("Notes: " + database.notes.countDocuments({}));
print("Posts: " + database.posts.countDocuments({}));

print("Setup completed successfully.");
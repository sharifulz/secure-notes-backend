import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { User } from '../modules/users/user.model.js';
import { Note } from '../modules/notes/note.model.js';
import { Post } from '../modules/posts/post.model.js';
try {
  await connectDatabase();
  for (const model of [User, Note, Post]) {
    const diff = await model.diffIndexes();
    console.log(model.collection.name, JSON.stringify(diff));
    if (diff.toCreate.length || diff.toDrop.length) process.exitCode = 1;
  }
} finally { await mongoose.disconnect(); }

import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema(
  {
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      required: [true, 'Task reference is required']
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Author user reference is required']
    },
    content: {
      type: String,
      required: [true, 'Comment content cannot be empty'],
      trim: true,
      maxlength: [5000, 'Comment content cannot exceed 5000 characters']
    },
    attachments: [
      {
        url: String,
        fileName: String,
        fileType: String,
        publicId: String
      }
    ]
  },
  {
    timestamps: true
  }
);

// Indexes
commentSchema.index({ task: 1, createdAt: 1 });
commentSchema.index({ author: 1 });

commentSchema.methods.toJSON = function () {
  const comment = this.toObject();
  delete comment.__v;
  return comment;
};

export const Comment = mongoose.models.Comment || mongoose.model('Comment', commentSchema);
export default Comment;

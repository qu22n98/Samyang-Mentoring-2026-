# Security Specification - Mentoring Hub

## Data Invariants
1. A Mentee profile can be created by any authenticated user.
2. Only the creator of a Mentee profile can edit or delete it.
3. Anyone can read Mentee profiles.
4. An Activity can be added to any Mentee profile by an authenticated user.
5. Only the creator of an Activity can edit or delete it.
6. Anyone can read Activities.
7. Anyone can like an Activity (by adding their UID to `likedBy`), but they cannot remove others' likes.
8. Comments can be added by any authenticated user.
9. Only the author can delete their comment.

## The Dirty Dozen Payloads (Target: Firestore Rules)

1. **Identity Spoofing (Mentee)**: Create a mentee with a `creatorId` that doesn't match the authenticated user.
2. **Unauthorized Edit (Mentee)**: Update a mentee profile created by another user.
3. **Ghost Field (Mentee)**: Add an `isAdmin: true` field to a mentee profile.
4. **Relational Sync Failure (Activity)**: Add an activity to a non-existent mentee ID path.
5. **ID Poisoning**: Use a 1.5KB string as a document ID for a mentee.
6. **Unauthorized Delete (Activity)**: Delete an activity created by another user.
7. **Type Mismatch (Amount)**: Set `amountSpent` to a string "1000".
8. **PII Leak**: Read a private collection (if any were added, though currently all are public).
9. **Like Spoofing**: Remove another user's UID from the `likedBy` array.
10. **Resource Exhaustion**: Send an activity `content` that is 2MB long (exceeding document limit or rule limit).
11. **Timestamp Spoofing**: Set `createdAt` to a date in the past instead of `request.time`.
12. **Comment Spoofing**: Create a comment with `authorId` pointing to another user.

## Test Runner Plan
I will use the `firestore.rules` file to prevent these.

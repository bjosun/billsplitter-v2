export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  households: string[];
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface CreateUserData {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

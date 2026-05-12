export interface Comment {
  id: string;
  text: string;
  date: string;
  author: string;
  authorId?: string;
}

export interface Activity {
  id: string;
  category: '직무연관' | '심리사회' | 'Purpose/Global/Digital';
  content: string;
  image: string;
  date: string;
  amountSpent: number;
  likedBy: string[];
  comments: Comment[];
  checklistItemId?: string;
  creatorId?: string;
}

export interface Mentee {
  id: string;
  name: string;
  department: string;
  mentorName?: string;
  mentorDept?: string;
  avatar?: string;
  activities: Activity[];
  aiSummary?: string;
  aiInsights?: string;
  aiRecommendations?: string[];
  aiFeedback?: string;
  aiKeywords?: string[];
  aiCharacterName?: string;
  pledge?: string;
  creatorId?: string;
}

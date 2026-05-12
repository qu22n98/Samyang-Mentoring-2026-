import { useState, useEffect, useMemo, MouseEvent } from "react";
import {
  Users,
  UserPlus,
  ArrowLeft,
  Briefcase,
  Plus,
  Pencil,
  ClipboardList,
  ChevronRight,
  X,
  MessageCircle,
  ThumbsUp,
  Camera,
  Send,
  Zap,
  Sparkles as SparklesIcon,
  LayoutGrid,
  ChevronLeft,
  Calendar as CalendarIcon,
  Globe,
  CheckCircle2,
  TrendingUp,
  BarChart3,
  PieChart as PieChartIcon,
  Trophy,
  Heart,
  Smile,
  ActivitySquare,
  Lightbulb,
  Sparkles,
  Compass,
  RefreshCw,
  Quote,
  LogIn,
  LogOut,
  Trash2,
  AlertCircle,
  CheckCircle,
  Info,
} from "lucide-react";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  collectionGroup,
  serverTimestamp,
  addDoc,
  Timestamp,
  getDocFromServer,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import {
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  User as FirebaseUser,
} from "firebase/auth";
import { db, auth } from "./lib/firebase";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  PieChart,
  Pie,
  Legend,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import { motion, AnimatePresence } from "motion/react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  isValid,
} from "date-fns";
import { Mentee, Activity, Comment } from "./types";
import { generateMenteeInsight } from "./services/geminiService";
import {
  MENTORING_CHECKLIST,
  getBiMonthlyPeriod,
  CategoryType,
  BI_MONTHLY_PERIODS,
} from "./constants";

const INITIAL_MENTEES: Mentee[] = [
  {
    id: "1",
    name: "김철수",
    department: "개발팀",
    mentorName: "박지용",
    mentorDept: "시니어 개발자",
    activities: [],
  },
  {
    id: "2",
    name: "이영희",
    department: "디자인팀",
    mentorName: "정수아",
    mentorDept: "디자인 총괄",
    activities: [],
  },
];

enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * 이미지 압축 및 리사이징 유틸리티
 */
const compressImage = (
  file: File,
  maxWidth: number,
  maxHeight: number,
): Promise<string> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        // 약 0.7 품질로 압축하여 base64 반환
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
    };
  });
};

const parseDateSafe = (dateVal: any) => {
  if (!dateVal) return new Date(0);

  // If it's a Firestore Timestamp or similar object
  if (dateVal.toDate && typeof dateVal.toDate === "function")
    return dateVal.toDate();
  if (dateVal.seconds && typeof dateVal.seconds === "number")
    return new Date(dateVal.seconds * 1000);
  if (dateVal.toMillis && typeof dateVal.toMillis === "function")
    return new Date(dateVal.toMillis());

  const dateStr = String(dateVal);
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;

    // Handle Korean format "YYYY. MM. dd." or similar
    const cleaned = dateStr.replace(
      /(\d{4})\. (\d{1,2})\. (\d{1,2})\./,
      "$1-$2-$3",
    );
    const d2 = new Date(cleaned);
    if (!isNaN(d2.getTime())) return d2;
  } catch (e) {
    // ignore
  }
  return new Date(0);
};

const MENTORING_START = new Date("2026-05-27");
const MENTORING_END = new Date("2026-11-30");

const isWithinMentoringPeriod = (dateStr: string) => {
  const d = parseDateSafe(dateStr);
  return d >= MENTORING_START && d <= MENTORING_END;
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [mentees, setMentees] = useState<Mentee[]>([]);
  const [globalActivities, setGlobalActivities] = useState<
    (Activity & { menteeName: string; menteeId: string })[]
  >([]);
  const [globalComments, setGlobalComments] = useState<
    (Comment & { menteeId: string; activityId: string; menteeName: string })[]
  >([]);
  const [selectedMenteeId, setSelectedMenteeId] = useState<string | null>(null);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isChecklistModalOpen, setIsChecklistModalOpen] = useState(false);
  const [isChecklistStatusModalOpen, setIsChecklistStatusModalOpen] =
    useState(false);
  const [isMenteeEditModalOpen, setIsMenteeEditModalOpen] = useState(false);
  const [newMentee, setNewMentee] = useState({
    name: "",
    dept: "",
    mentorName: "",
    mentorDept: "",
    avatar: "",
    pledge: "",
  });
  const [editMenteeData, setEditMenteeData] = useState({
    name: "",
    dept: "",
    mentorName: "",
    mentorDept: "",
    avatar: "",
    pledge: "",
  });
  const [currentCategory, setCurrentCategory] =
    useState<CategoryType>("직무연관");
  const [selectedChecklistItemId, setSelectedChecklistItemId] = useState<
    string | null
  >(null);
  const [actContent, setActContent] = useState("");
  const [actAmount, setActAmount] = useState("");
  const [actImage, setActImage] = useState("");
  const [actDate, setActDate] = useState("");
  const [editingActivityId, setEditingActivityId] = useState<string | null>(
    null,
  );
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [activityDetail, setActivityDetail] = useState<
    (Activity & { menteeName: string; menteeId: string }) | null
  >(null);
  const [newComment, setNewComment] = useState("");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [editActData, setEditActData] = useState({
    category: "직무연관" as CategoryType,
    content: "",
    image: "",
    date: "",
    amountSpent: 0,
    checklistItemId: null as string | null,
  });
  const [deleteConfirm, setDeleteConfirm] = useState<{
    show: boolean;
    type: "mentee" | "activity";
    id: string | null;
    parentId?: string;
    message: string;
  }>({ show: false, type: "mentee", id: null, message: "" });

  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [activePhase, setActivePhase] = useState<
    "all" | "Phase1" | "Phase2" | "Phase3"
  >("all");
  const [mainTab, setMainTab] = useState<"dashboard" | "calendar">("dashboard");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [resetConfirmCount, setResetConfirmCount] = useState(0);
  const [isResetting, setIsResetting] = useState(false);
  const [isAddingActivity, setIsAddingActivity] = useState(false);
  const [isRegisteringMentee, setIsRegisteringMentee] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentText, setEditCommentText] = useState("");
  const [globalAlert, setGlobalAlert] = useState<{
    show: boolean;
    title: string;
    message: string;
    type: "info" | "error" | "success";
  }>({
    show: false,
    title: "",
    message: "",
    type: "info",
  });

  const showAlert = (
    message: string,
    title = "알림",
    type: "info" | "error" | "success" = "info",
  ) => {
    setGlobalAlert({ show: true, title, message, type });
  };

  const menteeActivityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    globalActivities.forEach((act) => {
      if (act.menteeId) {
        counts[act.menteeId] = (counts[act.menteeId] || 0) + 1;
      }
    });
    return counts;
  }, [globalActivities]);

  const enrichedGlobalActivities = useMemo(() => {
    return globalActivities.map((act) => {
      const mentee = mentees.find((m) => m.id === act.menteeId);
      return {
        ...act,
        menteeName: mentee?.name || "알 수 없는 멘티",
        mentorName: mentee?.mentorName || "",
      };
    });
  }, [globalActivities, mentees]);

  const allActivities = useMemo(() => {
    const list = [...enrichedGlobalActivities];
    return list.sort((a, b) => {
      const getMillis = (val: any) => {
        if (!val) return 0;
        if (typeof val === "string") return new Date(val).getTime();
        if (typeof val?.toMillis === "function") return val.toMillis();
        if (val?.seconds) return val.seconds * 1000;
        return 0;
      };

      const timeB = getMillis(b.createdAt);
      const timeA = getMillis(a.createdAt);

      if (timeB !== timeA) return timeB - timeA;

      // Fallback to activity date if registered at the same time
      const dateB = parseDateSafe(b.date).getTime();
      const dateA = parseDateSafe(a.date).getTime();
      return dateB - dateA;
    });
  }, [enrichedGlobalActivities]);

  const allComments = useMemo(() => {
    const list = [...globalComments];
    return list.sort((a, b) => {
      const getMillis = (val: any) => {
        if (!val) return 0;
        if (typeof val === "string") return new Date(val).getTime();
        if (typeof val?.toMillis === "function") return val.toMillis();
        if (val?.seconds) return val.seconds * 1000;
        return 0;
      };
      return getMillis(b.date) - getMillis(a.date);
    });
  }, [globalComments]);

  const globalSortedMentees = useMemo(() => {
    const list = [...mentees];
    return list.sort((a, b) => {
      const aCount = menteeActivityCounts[a.id] || 0;
      const bCount = menteeActivityCounts[b.id] || 0;
      return bCount - aCount;
    });
  }, [mentees, menteeActivityCounts]);

  const topMenteeId = globalSortedMentees[0]?.id;

  const sortedMentees = useMemo(() => {
    // filteredMentees is a local variable from filter logic, but I should probably move filtering into useMemo too
    const filtered = mentees.filter((m) => {
      const matchesSearch =
        m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.department.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.mentorName.toLowerCase().includes(searchTerm.toLowerCase());

      if (activePhase === "all") return matchesSearch;

      const counts = menteeActivityCounts[m.id] || 0;
      if (activePhase === "Phase1") return matchesSearch && counts < 4;
      if (activePhase === "Phase2")
        return matchesSearch && counts >= 4 && counts < 8;
      if (activePhase === "Phase3") return matchesSearch && counts >= 8;

      return matchesSearch;
    });

    return filtered.sort((a, b) => {
      const aCount = menteeActivityCounts[a.id] || 0;
      const bCount = menteeActivityCounts[b.id] || 0;
      return bCount - aCount;
    });
  }, [mentees, searchTerm, activePhase, menteeActivityCounts]);

  const hallOfFame = useMemo(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const activityCounts: Record<string, { count: number; name: string }> = {};
    const commentCounts: Record<string, { count: number; name: string }> = {};
    const likeCounts: Record<string, { count: number; name: string }> = {};

    const getName = (uid: string, defaultName: string) => {
      const mentee = mentees.find((m) => m.creatorId === uid);
      return mentee ? mentee.name : defaultName;
    };

    // Activity King (Most activities created this month)
    globalActivities.forEach((act) => {
      const actDate = parseDateSafe(act.date);
      if (actDate >= startOfMonth && act.creatorId) {
        if (!activityCounts[act.creatorId]) {
          activityCounts[act.creatorId] = {
            count: 0,
            name: getName(act.creatorId, "익명 멘토/멘티"),
          };
        }
        activityCounts[act.creatorId].count++;
      }

      // Like King (Most likes given this month - approximating via current like state)
      if (act.likedBy && Array.isArray(act.likedBy)) {
        act.likedBy.forEach((uid) => {
          if (!likeCounts[uid]) {
            likeCounts[uid] = {
              count: 0,
              name: getName(uid, "활동적인 선배님"),
            };
          }
          likeCounts[uid].count++;
        });
      }
    });

    // Comment King (Most comments created this month)
    globalComments.forEach((cmt) => {
      const cmtDate = parseDateSafe(cmt.date);
      if (cmtDate >= startOfMonth && cmt.authorId) {
        if (!commentCounts[cmt.authorId]) {
          commentCounts[cmt.authorId] = {
            count: 0,
            name: cmt.author || getName(cmt.authorId, "따뜻한 선배님"),
          };
        }
        commentCounts[cmt.authorId].count++;
      }
    });

    const getTop = (counts: Record<string, { count: number; name: string }>) => {
      const sorted = Object.values(counts).sort((a, b) => b.count - a.count);
      return sorted.length > 0 && sorted[0].count > 0 ? sorted[0] : null;
    };

    return {
      activityKing: getTop(activityCounts),
      commentKing: getTop(commentCounts),
      likeKing: getTop(likeCounts),
    };
  }, [globalActivities, globalComments, mentees]);

  const mentoringProgress = useMemo(() => {
    const today = new Date();
    if (today < MENTORING_START) {
      const diff = MENTORING_START.getTime() - today.getTime();
      const dDay = Math.ceil(diff / (1000 * 60 * 60 * 24));
      return { progress: 0, dayCount: 0, status: `D-${dDay}` };
    }

    const totalTime = MENTORING_END.getTime() - MENTORING_START.getTime();
    const elapsed = today.getTime() - MENTORING_START.getTime();
    const progress = Math.min(Math.max((elapsed / totalTime) * 100, 0), 100);
    const dayCount = Math.floor(elapsed / (1000 * 60 * 60 * 24));

    return { progress, dayCount, status: `${dayCount}일차` };
  }, []);

  useEffect(() => {
    setActivePhase("all");
  }, [selectedMenteeId]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Sync mentees from Firestore
  useEffect(() => {
    if (!authReady || !user) {
      setMentees([]);
      return;
    }

    const q = query(collection(db, "mentees"), orderBy("name"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const menteesList: Mentee[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          menteesList.push({
            ...data,
            id: doc.id,
            activities: [], // Will load activities separately or when selected
          } as any);
        });
        setMentees((prev) => {
          return menteesList.map((newMentee) => {
            const existing = prev.find((m) => m.id === newMentee.id);
            return {
              ...newMentee,
              activities: existing ? existing.activities : [],
            };
          });
        });
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "mentees");
      },
    );

    return () => unsubscribe();
  }, [authReady, user]);

  // Sync activities for the selected mentee
  useEffect(() => {
    if (!authReady || !user || !selectedMenteeId) return;

    const q = query(
      collection(db, `mentees/${selectedMenteeId}/activities`),
      orderBy("date", "desc"),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const activitiesList: Activity[] = [];
        snapshot.forEach((doc) => {
          activitiesList.push({
            ...doc.data(),
            id: doc.id,
          } as any);
        });
        setMentees((prev) =>
          prev.map((m) =>
            m.id === (selectedMenteeId as any)
              ? { ...m, activities: activitiesList }
              : m,
          ),
        );
      },
      (error) => {
        handleFirestoreError(
          error,
          OperationType.GET,
          `mentees/${selectedMenteeId}/activities`,
        );
      },
    );

    return () => unsubscribe();
  }, [authReady, user, selectedMenteeId]);

  // Sync global activities for the feed
  useEffect(() => {
    if (!authReady || !user) {
      setGlobalActivities([]);
      return;
    }

    // Collection Group query for activities across all mentees
    // Increase limit to ensure ranking is accurate for more entries
    const q = query(
      collectionGroup(db, "activities"),
      orderBy("date", "desc"),
      limit(500),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const activitiesList: any[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const menteeId = docSnap.ref.parent.parent?.id;
          activitiesList.push({
            ...data,
            id: docSnap.id,
            menteeId: menteeId || "",
          });
        });
        setGlobalActivities(activitiesList);
      },
      (error) => {
        console.warn("Global activities sync failed:", error);
      },
    );

    return () => unsubscribe();
  }, [authReady, user]); // Removed mentees dependency to avoid frequent reconnects

  // Sync global comments for the dashboard social feed
  useEffect(() => {
    if (!authReady || !user) {
      setGlobalComments([]);
      return;
    }

    const q = query(
      collectionGroup(db, "comments"),
      orderBy("date", "desc"),
      limit(30),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const commentsList: any[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          // comment -> activities -> mentees
          const activityId = docSnap.ref.parent.parent?.id;
          const menteeId = docSnap.ref.parent.parent?.parent.parent?.id;
          const mentee = mentees.find((m) => m.id === menteeId);

          commentsList.push({
            ...data,
            id: docSnap.id,
            activityId: activityId || "",
            menteeId: menteeId || "",
            menteeName: mentee?.name || "알 수 없는 멘티",
          });
        });
        setGlobalComments(commentsList);
      },
      (error) => {
        console.warn(
          "Global comments sync failed (index might be building):",
          error,
        );
      },
    );

    return () => unsubscribe();
  }, [authReady, user, mentees]);

  // Sync comments for the selected activity
  useEffect(() => {
    if (!authReady || !user || !activityDetail) return;

    const q = query(
      collection(
        db,
        `mentees/${activityDetail.menteeId}/activities/${activityDetail.id}/comments`,
      ),
      orderBy("date", "asc"),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const commentsList: Comment[] = [];
        snapshot.forEach((doc) => {
          commentsList.push({
            ...doc.data(),
            id: doc.id,
          } as any);
        });
        setActivityDetail((prev) =>
          prev ? { ...prev, comments: commentsList } : null,
        );
      },
      (error) => {
        handleFirestoreError(
          error,
          OperationType.GET,
          `mentees/${activityDetail.menteeId}/activities/${activityDetail.id}/comments`,
        );
      },
    );

    return () => unsubscribe();
  }, [authReady, user, activityDetail?.id]);
  useEffect(() => {
    localStorage.setItem("mentees", JSON.stringify(mentees));
  }, [mentees]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [selectedMenteeId, mainTab]);

  const selectedMentee = mentees.find((m) => m.id === selectedMenteeId);

  const getUserDisplayName = () => {
    if (!user) return "익명";
    const myProfile = mentees.find((m) => m.creatorId === user.uid);
    return myProfile?.name || user.displayName || "익명";
  };

  const handleToggleLike = async (activity: any) => {
    if (!user || !activity) return;
    const likedBy = activity.likedBy || [];
    const isLiked = likedBy.includes(user.uid);
    const newLikedBy = isLiked
      ? likedBy.filter((uid: string) => uid !== user.uid)
      : [...likedBy, user.uid];

    try {
      await updateDoc(
        doc(db, `mentees/${activity.menteeId}/activities`, activity.id),
        { likedBy: newLikedBy },
      );
      // Update local detail state if it's the current one
      if (activityDetail && activityDetail.id === activity.id) {
        setActivityDetail((prev) =>
          prev ? { ...prev, likedBy: newLikedBy } : null,
        );
      }
    } catch (error) {
      console.error("Like toggle failed:", error);
    }
  };

  const handleAddMentee = async () => {
    if (!newMentee.name || !newMentee.dept || !user) return;
    if (isRegisteringMentee) return;

    // Check if user already has a profile (Strictly one per account)
    const existingProfile = mentees.find((m) => m.creatorId === user.uid);

    if (existingProfile) {
      showAlert(
        "이미 등록된 신입사원 프로필이 있습니다. 계정당 하나의 프로필만 생성 가능합니다.",
        "등록 불가",
        "error",
      );
      setIsAddModalOpen(false);
      return;
    }

    setIsRegisteringMentee(true);
    try {
      // Use user.uid as the document ID to fundamentally prevent duplicates
      const menteeRef = doc(db, "mentees", user.uid);
      await setDoc(menteeRef, {
        name: newMentee.name,
        department: newMentee.dept,
        mentorName: newMentee.mentorName,
        mentorDept: newMentee.mentorDept,
        avatar: newMentee.avatar,
        pledge: newMentee.pledge,
        creatorId: user.uid,
        createdAt: serverTimestamp(),
      });

      setNewMentee({
        name: "",
        dept: "",
        mentorName: "",
        mentorDept: "",
        avatar: "",
        pledge: "",
      });
      setIsAddModalOpen(false);
      showAlert(
        "신입사원 프로필이 성공적으로 등록되었습니다.",
        "등록 완료",
        "success",
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "mentees");
    } finally {
      setIsRegisteringMentee(false);
    }
  };

  const handleDeleteMentee = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteConfirm({
      show: true,
      type: "mentee",
      id: id as any,
      message:
        "정말 삭제하시겠습니까? 해당 사원과 관련된 모든 활동 내역이 영구적으로 삭제됩니다.",
    });
  };

  const confirmDelete = async () => {
    if (!user) return;
    try {
      if (deleteConfirm.type === "mentee") {
        await deleteDoc(doc(db, "mentees", String(deleteConfirm.id)));
        if (selectedMenteeId === deleteConfirm.id) setSelectedMenteeId(null);
      } else {
        const mId = deleteConfirm.parentId || selectedMenteeId;
        if (!mId) return;

        // 1. Delete comments associated with this activity
        const commentsRef = collection(
          db,
          `mentees/${mId}/activities/${deleteConfirm.id}/comments`,
        );
        const commentsSnap = await getDocs(commentsRef);
        const deletePromises = commentsSnap.docs.map((d) => deleteDoc(d.ref));
        await Promise.all(deletePromises);

        // 2. Delete the activity itself
        await deleteDoc(
          doc(db, `mentees/${mId}/activities`, String(deleteConfirm.id)),
        );
        if (activityDetail?.id === deleteConfirm.id) setActivityDetail(null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, "document");
    }
    setDeleteConfirm({ ...deleteConfirm, show: false });
  };

  const handleGenerateAI = async () => {
    if (!selectedMentee || !selectedMenteeId) return;

    // Calculate incomplete tasks from the checklist
    const allChecklistItems = Object.values(MENTORING_CHECKLIST).flat();
    const completedItemIds = new Set(
      selectedMentee.activities
        .map((a) => a.checklistItemId)
        .filter((id) => !!id),
    );
    const incompleteTasks = allChecklistItems
      .filter((item) => !completedItemIds.has(item.id))
      .map((item) => item.title);

    setIsGeneratingSummary(true);
    try {
      const insight = await generateMenteeInsight(
        selectedMentee.name,
        selectedMentee.activities,
        incompleteTasks,
      );

      const updateData = {
        aiSummary: insight.summary,
        aiRecommendations: insight.recommendations,
        aiFeedback: insight.feedback,
        aiCharacterName: insight.characterName,
      };

      await updateDoc(doc(db, "mentees", selectedMenteeId), updateData);
    } catch (error) {
      console.error(error);
      showAlert("AI 요약 생성 중 오류가 발생했습니다.", "AI 오류", "error");
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const stats = selectedMentee
    ? {
        job: selectedMentee.activities.filter((a) => a.category === "직무연관")
          .length,
        psy: selectedMentee.activities.filter((a) => a.category === "심리사회")
          .length,
        pgd: selectedMentee.activities.filter(
          (a) => a.category === "Purpose/Global/Digital",
        ).length,
      }
    : null;

  const getCheckCompletionStatus = (id: string, dateStr: string) => {
    if (!selectedMentee) return null;
    const date = dateStr ? new Date(dateStr) : new Date();
    const period = getBiMonthlyPeriod(date);
    if (!period) return null;

    const exists = selectedMentee.activities.find((a) => {
      if (a.checklistItemId !== id) return false;
      const aDate = new Date(a.date);
      const aPeriod = getBiMonthlyPeriod(aDate);
      return aPeriod?.name === period.name;
    });

    return exists ? period.name : null;
  };

  const handleAddActivity = async () => {
    if (!user) {
      showAlert(
        "활동을 기록하려면 로그인이 필요합니다.",
        "로그인 필요",
        "error",
      );
      return;
    }
    if (!selectedMenteeId) {
      showAlert(
        "활동을 등록할 멘티를 선택해주세요.",
        "멘티 선택 필요",
        "error",
      );
      return;
    }

    const mentee = mentees.find((m) => m.id === selectedMenteeId);
    const isOwner = mentee?.creatorId === user.uid;
    const isAdmin = user.email?.toLowerCase() === "qu22n98@gmail.com";

    if (!isOwner && !isAdmin) {
      showAlert(
        "권한이 없습니다. 본인의 멘티 페이지에만 활동을 기록할 수 있습니다.",
        "권한 없음",
        "error",
      );
      return;
    }

    const missingFields = [];
    if (!actDate) missingFields.push("활동 일자");
    if (!selectedChecklistItemId) missingFields.push("활동 분류 (체크리스트)");
    if (!(actContent || "").trim()) missingFields.push("활동 내용");
    if (!actImage) missingFields.push("증빙 사진");

    if (missingFields.length > 0) {
      showAlert(
        `활동을 저장하기 위해 다음 필수 항목을 입력해주세요:\n\n${missingFields.map((f) => `• ${f}`).join("\n")}`,
        "필수 항목 누락",
        "error",
      );
      return;
    }

    if (actDate && !isWithinMentoringPeriod(actDate)) {
      showAlert(
        "선택하신 날짜는 멘토링 활동 기간이 아닙니다. 기간 내 날짜를 선택해주세요. (2026-05-27 ~ 2026-11-30)",
        "기간 확인",
        "error",
      );
      return;
    }

    setIsAddingActivity(true);
    try {
      await addDoc(collection(db, `mentees/${selectedMenteeId}/activities`), {
        category: currentCategory,
        content: actContent,
        image: actImage,
        date: actDate
          ? new Date(actDate).toISOString()
          : new Date().toISOString(),
        amountSpent: parseInt(actAmount) || 0,
        likedBy: [],
        checklistItemId: selectedChecklistItemId || null,
        creatorId: user.uid,
        createdAt: serverTimestamp(),
      });

      showAlert(
        "활동 기록이 성공적으로 저장되었습니다.",
        "저장 완료",
        "success",
      );

      setActContent("");
      setActAmount("");
      setActImage("");
      setActDate("");
      setSelectedChecklistItemId(null);
    } catch (error) {
      console.error("Save Activity Error:", error);
      showAlert(
        "활동 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        "오류 발생",
        "error",
      );
      handleFirestoreError(
        error,
        OperationType.CREATE,
        `mentees/${selectedMenteeId}/activities`,
      );
    } finally {
      setIsAddingActivity(false);
    }
  };

  const handleEditActivity = async () => {
    if (!selectedMenteeId || !editingActivityId || !user) return;

    const missingFields = [];
    if (!editActData.date) missingFields.push("활동 일자");
    if (!editActData.checklistItemId)
      missingFields.push("활동 분류 (체크리스트)");
    if (!editActData.content.trim()) missingFields.push("활동 내용");
    if (!editActData.image) missingFields.push("증빙 사진");

    if (missingFields.length > 0) {
      showAlert(
        `활동을 수정하기 위해 다음 필수 항목을 입력해주세요:\n\n${missingFields.map((f) => `• ${f}`).join("\n")}`,
        "필수 항목 누락",
        "error",
      );
      return;
    }

    const activity = allActivities.find((a) => a.id === editingActivityId);
    const isAdmin = user.email?.toLowerCase() === "qu22n98@gmail.com";
    if (!activity || (activity.creatorId !== user.uid && !isAdmin)) {
      showAlert("본인의 활동만 수정할 수 있습니다.", "권한 없음", "error");
      return;
    }

    if (editActData.date && !isWithinMentoringPeriod(editActData.date)) {
      showAlert(
        "선택하신 날짜는 멘토링 활동 기간이 아닙니다.",
        "기간 확인",
        "error",
      );
      return;
    }

    try {
      await updateDoc(
        doc(db, `mentees/${selectedMenteeId}/activities`, editingActivityId),
        {
          category: editActData.category,
          content: editActData.content,
          image: editActData.image,
          date: editActData.date
            ? new Date(editActData.date).toISOString()
            : new Date().toISOString(),
          amountSpent: editActData.amountSpent,
          checklistItemId: editActData.checklistItemId || null,
        },
      );
      setIsEditModalOpen(false);
      setEditingActivityId(null);
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `mentees/${selectedMenteeId}/activities/${editingActivityId}`,
      );
    }
  };

  const handleUpdateMentee = async () => {
    if (
      !editMenteeData.name ||
      !editMenteeData.dept ||
      !selectedMenteeId ||
      !user
    )
      return;

    const mentee = mentees.find((m) => m.id === selectedMenteeId);
    const isAdmin = user.email?.toLowerCase() === "qu22n98@gmail.com";
    if (!mentee || (mentee.creatorId !== user.uid && !isAdmin)) {
      showAlert(
        "본인이 등록한 멘티 프로필만 수정할 수 있습니다.",
        "권한 없음",
        "error",
      );
      return;
    }

    try {
      await updateDoc(doc(db, "mentees", selectedMenteeId), {
        name: editMenteeData.name,
        department: editMenteeData.dept,
        mentorName: editMenteeData.mentorName,
        mentorDept: editMenteeData.mentorDept,
        avatar: editMenteeData.avatar,
        pledge: editMenteeData.pledge,
      });
      setIsMenteeEditModalOpen(false);
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `mentees/${selectedMenteeId}`,
      );
    }
  };

  const startEditingMentee = (mentee: Mentee) => {
    setEditMenteeData({
      name: mentee.name,
      dept: mentee.department,
      mentorName: mentee.mentorName || "",
      mentorDept: mentee.mentorDept || "",
      avatar: mentee.avatar || "",
      pledge: mentee.pledge || "",
    });
    setIsMenteeEditModalOpen(true);
  };

  const handleLike = async (e: MouseEvent, mId: string, aId: string) => {
    e.stopPropagation();
    if (!user) return;

    const activityRef = doc(db, `mentees/${mId}/activities`, aId);

    // Find the current likes to decide whether to add or remove
    const mentee = mentees.find((m) => m.id === mId);
    let activity = mentee?.activities.find((a) => a.id === aId);

    // If not found in nested activities, search global feed
    if (!activity) {
      activity = globalActivities.find((a) => a.id === aId);
    }

    if (!activity) return;

    const isLiked = activity.likedBy.includes(user.uid);

    try {
      await updateDoc(activityRef, {
        likedBy: isLiked ? arrayRemove(user.uid) : arrayUnion(user.uid),
      });
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `mentees/${mId}/activities/${aId}`,
      );
    }
  };

  const handleAddComment = async () => {
    if (!newComment || !activityDetail || !user) return;

    // Determine the author's name: if they have a registered mentee profile, use that name
    const currentUserMentee = mentees.find((m) => m.creatorId === user.uid);
    const authorName = currentUserMentee
      ? currentUserMentee.name
      : user.displayName || "선배님";

    try {
      await addDoc(
        collection(
          db,
          `mentees/${activityDetail.menteeId}/activities/${activityDetail.id}/comments`,
        ),
        {
          text: newComment,
          date: serverTimestamp(),
          author: authorName,
          authorId: user.uid,
        },
      );
      setNewComment("");
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.CREATE,
        `mentees/${activityDetail.menteeId}/activities/${activityDetail.id}/comments`,
      );
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!activityDetail || !user) return;

    try {
      await deleteDoc(
        doc(
          db,
          `mentees/${activityDetail.menteeId}/activities/${activityDetail.id}/comments`,
          commentId,
        ),
      );
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.DELETE,
        `mentees/${activityDetail.menteeId}/activities/${activityDetail.id}/comments/${commentId}`,
      );
    }
  };

  const handleUpdateComment = async (commentId: string) => {
    if (!activityDetail || !editCommentText || !user) return;

    try {
      await updateDoc(
        doc(
          db,
          `mentees/${activityDetail.menteeId}/activities/${activityDetail.id}/comments`,
          commentId,
        ),
        {
          text: editCommentText,
        },
      );
      setEditingCommentId(null);
      setEditCommentText("");
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `mentees/${activityDetail.menteeId}/activities/${activityDetail.id}/comments/${commentId}`,
      );
    }
  };

  const handleDeleteActivity = (
    e: MouseEvent,
    activityId: string,
    menteeId?: string,
  ) => {
    e.stopPropagation();
    const mId = menteeId || selectedMenteeId;
    if (!mId) return;

    setDeleteConfirm({
      show: true,
      type: "activity",
      id: activityId,
      parentId: mId,
      message: "이 활동 내역을 삭제하시겠습니까? 복구할 수 없습니다.",
    });
  };

  const startEditingActivity = (activity: Activity) => {
    setEditingActivityId(activity.id);
    setEditActData({
      category: activity.category,
      content: activity.content,
      image: activity.image || "",
      date: activity.date ? activity.date.split("T")[0] : "",
      amountSpent: activity.amountSpent || 0,
      checklistItemId: activity.checklistItemId || null,
    });
    setIsEditModalOpen(true);
  };

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      if (error.code === "auth/cancelled-popup-request") {
        console.log("Login popup was closed or overtaken by a new request.");
      } else if (error.code === "auth/popup-closed-by-user") {
        console.log("Login popup was closed by user.");
      } else {
        console.error("Login failed", error);
        showAlert(
          `로그인 중 오류가 발생했습니다: ${error.message}`,
          "로그인 실패",
          "error",
        );
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setSelectedMenteeId(null);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const handleResetAllData = async () => {
    if (!user || user.email?.toLowerCase() !== "qu22n98@gmail.com") return;

    if (resetConfirmCount === 0) {
      setResetConfirmCount(1);
      setTimeout(() => setResetConfirmCount(0), 4000); // 4초 후 초기화
      return;
    }

    setIsResetting(true);
    setResetConfirmCount(0);
    try {
      // 1. Delete all comments across all sub-collections
      const commentsSnap = await getDocs(
        query(collectionGroup(db, "comments")),
      );
      const commentDeletes = commentsSnap.docs.map((d) => deleteDoc(d.ref));
      await Promise.all(commentDeletes);

      // 2. Delete all activities across all sub-collections
      const activitiesSnap = await getDocs(
        query(collectionGroup(db, "activities")),
      );
      const activityDeletes = activitiesSnap.docs.map((d) => deleteDoc(d.ref));
      await Promise.all(activityDeletes);

      // 3. Delete all mentees
      const menteesSnap = await getDocs(collection(db, "mentees"));
      const menteeDeletes = menteesSnap.docs.map((d) => deleteDoc(d.ref));
      await Promise.all(menteeDeletes);

      // Force local state clear
      setGlobalComments([]);
      setGlobalActivities([]);
      setMentees([]);
      setSelectedMenteeId(null);
      setMainTab("dashboard");
    } catch (error) {
      console.error("Reset failed:", error);
      handleFirestoreError(error, OperationType.DELETE, "all-data");
    } finally {
      setIsResetting(false);
    }
  };

  const getBadgeInfo = (activityCount: number) => {
    const progress = Math.min((activityCount / 12) * 100, 100);

    let badge = {
      icon: "🌱",
      text: "신입 새싹",
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      border: "border-emerald-100",
    };
    if (activityCount >= 12)
      badge = {
        icon: "👑",
        text: "성장 마스터",
        color: "text-amber-600",
        bg: "bg-amber-50",
        border: "border-amber-100",
      };
    else if (activityCount >= 8)
      badge = {
        icon: "🔥",
        text: "열정 메이커",
        color: "text-indigo-600",
        bg: "bg-indigo-50",
        border: "border-indigo-100",
      };
    else if (activityCount >= 4)
      badge = {
        icon: "🌳",
        text: "쑥쑥 꿈나무",
        color: "text-blue-600",
        bg: "bg-blue-50",
        border: "border-blue-100",
      };

    return { progress, badge };
  };

  const CalendarView = ({
    targetActivities,
  }: {
    targetActivities: (Activity & { menteeName?: string; menteeId?: number })[];
  }) => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);
    const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

    const getActivitiesForDay = (day: Date) => {
      const year = day.getFullYear();
      const month = day.getMonth();
      const date = day.getDate();

      return (
        targetActivities.filter((a) => {
          try {
            const dateStr = String(a.date);
            let actDate = new Date(dateStr);

            if (isNaN(actDate.getTime())) {
              const cleaned = dateStr.replace(
                /(\d{4})\. (\d{1,2})\. (\d{1,2})\./,
                "$1-$2-$3",
              );
              actDate = new Date(cleaned);
            }

            if (isNaN(actDate.getTime())) return false;

            return (
              actDate.getFullYear() === year &&
              actDate.getMonth() === month &&
              actDate.getDate() === date
            );
          } catch (e) {
            return false;
          }
        }) || []
      );
    };

    return (
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
          <h4 className="font-bold text-gray-900">
            {format(currentMonth, "yyyy년 MM월")}
          </h4>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              className="p-1.5 hover:bg-white rounded-lg border border-transparent hover:border-gray-200 text-gray-400 hover:text-gray-600 transition-all"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              className="p-1.5 hover:bg-white rounded-lg border border-transparent hover:border-gray-200 text-gray-400 hover:text-gray-600 transition-all"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/30">
          {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
            <div
              key={d}
              className="py-2 text-center text-[10px] font-black text-gray-400 uppercase tracking-widest"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {calendarDays.map((day, i) => {
            const dayActivities = getActivitiesForDay(day);
            const isCurrentMonth = isSameMonth(day, monthStart);
            const isTodayDate = isSameDay(day, new Date());

            return (
              <div
                key={i}
                className={`min-h-[100px] border-r border-b border-gray-50 p-2 transition-colors ${
                  !isCurrentMonth ? "bg-gray-50/50" : "bg-white"
                } ${isTodayDate ? " ring-1 ring-inset ring-blue-100" : ""}`}
              >
                <div className="flex justify-between items-start mb-1">
                  <span
                    className={`text-xs font-bold ${
                      !isCurrentMonth
                        ? "text-gray-300"
                        : isTodayDate
                          ? "text-blue-600"
                          : "text-gray-400"
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                </div>
                <div className="space-y-1">
                  {dayActivities.map((a) => (
                    <div
                      key={a.id}
                      onClick={() =>
                        setActivityDetail({
                          ...a,
                          menteeName: a.menteeName || "알 수 없는 멘티",
                        })
                      }
                      className={`text-[9px] p-1 rounded font-bold truncate cursor-pointer transition-transform hover:scale-105 border shadow-sm flex items-center gap-1 ${
                        a.category === "직무연관"
                          ? "bg-indigo-50 text-indigo-700 border-indigo-100"
                          : a.category === "심리사회"
                            ? "bg-rose-50 text-rose-700 border-rose-100"
                            : "bg-emerald-50 text-emerald-700 border-emerald-100"
                      }`}
                      title={`${a.menteeName ? `[${a.menteeName}] ` : ""}${a.content}`}
                    >
                      {a.menteeName && (
                        <span className="text-blue-600 font-extrabold flex-shrink-0">
                          [{a.menteeName}]
                        </span>
                      )}
                      <span className="truncate">{a.content}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const formatDate = (dateVal: any) => {
    try {
      const d = parseDateSafe(dateVal);
      if (d.getTime() > 0) {
        return d.toLocaleDateString("ko-KR", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      }
      return String(dateVal || "");
    } catch {
      return String(dateVal || "");
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-pink-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-10 rounded-[48px] shadow-2xl border border-white text-center max-w-md w-full"
        >
          <div className="mb-8 relative inline-block">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-6 rounded-[32px] shadow-lg">
              <Users className="text-white w-12 h-12" />
            </div>
            <Sparkles className="absolute -top-4 -right-4 text-amber-400 w-10 h-10 animate-pulse" />
          </div>
          <h1 className="text-3xl font-black text-gray-900 mb-4 tracking-tight">
            성장 마일스톤 <br />
            <span className="text-blue-600">멘토링 허브</span>
          </h1>
          <p className="text-gray-500 mb-10 leading-relaxed font-medium">
            우리 팀의 성장을 기록하고 공유하세요. <br />
            멘토와 멘티가 함께 만드는 시너지.
          </p>
          <button
            onClick={handleLogin}
            disabled={isLoggingIn}
            className={`w-full bg-gray-900 text-white flex items-center justify-center gap-3 py-5 rounded-[24px] font-black text-lg transition-all hover:scale-[1.02] shadow-xl hover:shadow-gray-200 ${isLoggingIn ? "opacity-70 cursor-not-allowed" : "hover:bg-gray-800"}`}
          >
            {isLoggingIn ? (
              <RefreshCw className="animate-spin" size={24} />
            ) : (
              <LogIn size={24} />
            )}
            {isLoggingIn ? "로그인 중..." : "Google로 로그인하기"}
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F1F5F9] flex flex-col relative">
      {/* Premium Background Elements */}
      <div className="absolute top-0 left-0 w-full h-[600px] bg-gradient-to-b from-blue-50/50 via-indigo-50/20 to-transparent pointer-events-none" />
      <div className="absolute top-[5%] right-[-10%] w-[500px] h-[500px] bg-blue-400/5 blur-[120px] rounded-full pointer-events-none animate-pulse" />
      <div className="absolute bottom-[10%] left-[-5%] w-[400px] h-[400px] bg-indigo-400/5 blur-[100px] rounded-full pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-full opacity-[0.03] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]" />

      {/* Header */}
      <header className="bg-blue-600 sticky top-0 z-50 border-b border-blue-700 shadow-xl shadow-blue-900/10">
        <div className="max-w-5xl mx-auto px-4 h-20 flex items-center justify-between font-sans">
          <div
            className="flex items-center gap-3 cursor-pointer group"
            onClick={() => {
              setSelectedMenteeId(null);
              setMainTab("dashboard");
            }}
          >
            <div className="bg-white p-2.5 rounded-2xl text-blue-600 shadow-lg group-hover:rotate-6 transition-transform">
              <Users size={22} />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-white leading-none">
                삼양그룹
              </h1>
              <p className="text-[10px] font-black text-blue-200 uppercase tracking-widest mt-1">
                신입사원 멘토링
              </p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-1 bg-white/10 p-1.5 rounded-2xl border border-white/10 backdrop-blur-sm">
            <button
              onClick={() => {
                setMainTab("dashboard");
                setSelectedMenteeId(null);
              }}
              className={`px-5 py-2.5 rounded-xl text-sm font-black transition-all flex items-center gap-2 ${
                mainTab === "dashboard" && !selectedMenteeId
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-white hover:bg-white/10"
              }`}
            >
              <LayoutGrid size={18} />
              대시보드
            </button>
            <button
              onClick={() => {
                setMainTab("calendar");
                setSelectedMenteeId(null);
              }}
              className={`px-5 py-2.5 rounded-xl text-sm font-black transition-all flex items-center gap-2 ${
                mainTab === "calendar"
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-white hover:bg-white/10"
              }`}
            >
              <CalendarIcon size={18} />
              전체 일정
            </button>
            {mentees.some((m) => m.creatorId === user?.uid) && (
              <button
                onClick={() => {
                  const myProfile = mentees.find(
                    (m) => m.creatorId === user?.uid,
                  );
                  if (myProfile) {
                    setMainTab("dashboard");
                    setSelectedMenteeId(myProfile.id);
                  }
                }}
                className={`px-5 py-2.5 rounded-xl text-sm font-black transition-all flex items-center gap-2 ${
                  mainTab === "dashboard" &&
                  selectedMenteeId ===
                    mentees.find((m) => m.creatorId === user?.uid)?.id
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-white hover:bg-white/10"
                }`}
              >
                <Briefcase size={18} />
                나의 페이지
              </button>
            )}
          </div>
          {!selectedMenteeId &&
            !mentees.some((m) => m.creatorId === user?.uid) && (
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="bg-white text-blue-600 px-6 py-3 rounded-2xl flex items-center gap-2 transition-all shadow-xl shadow-blue-900/20 font-bold active:scale-95 hover:bg-blue-50"
              >
                <UserPlus size={20} />
                신입사원 추가
              </button>
            )}
            {/* Auth Area */}
            {user && (
              <div className="flex items-center gap-3 ml-4 pl-4 border-l border-white/20">
                <div className="hidden lg:block text-right">
                  <p className="text-[10px] font-black text-blue-200 uppercase tracking-widest leading-none mb-1">Authenticated</p>
                  <p className="text-sm font-black text-white">{getUserDisplayName()}</p>
                </div>
                <button
                  onClick={() => setShowLogoutConfirm(true)}
                  className="w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-xl flex items-center justify-center transition-all border border-white/10 shadow-sm group"
                  title="로그아웃"
                >
                  <LogOut size={18} className="group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
            )}
          </div>
        </header>

      <main className="max-w-5xl mx-auto p-4 md:p-8 w-full flex-grow">
        <AnimatePresence mode="wait">
          {selectedMenteeId ? (
            <motion.div
              key="detail"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="w-full"
            >
              <button
                onClick={() => setSelectedMenteeId(null)}
                className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors mb-6 font-medium group"
              >
                <ArrowLeft
                  size={18}
                  className="group-hover:-translate-x-1 transition-transform"
                />
                <span>대시보드로 돌아가기</span>
              </button>

              <div className="flex flex-col md:flex-row gap-8">
                {/* Profile & Form */}
                <div className="md:w-1/3 xl:w-1/4 space-y-6">
                  <div className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm flex flex-col items-center text-center relative group vibrant-card">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50/50 rounded-full -mr-16 -mt-16 blur-3xl group-hover:bg-indigo-100/50 transition-colors pointer-events-none" />

                    <div className="relative mb-6 mt-10">
                      {selectedMentee?.pledge && (
                        <motion.div
                          initial={{ opacity: 0, y: 10, scale: 0.8 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          className="absolute -top-16 left-1/2 -translate-x-1/2 w-44 bg-white p-3 rounded-2xl shadow-xl border border-blue-100 z-50 pointer-events-none"
                        >
                          <p className="text-[10px] font-black text-blue-600 italic text-center leading-tight">
                            "{selectedMentee.pledge}"
                          </p>
                          {/* Triangle tail */}
                          <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-r border-b border-blue-100 rotate-45" />
                        </motion.div>
                      )}
                      <div
                        onClick={() => {
                          if (
                            user &&
                            (selectedMentee?.creatorId === user.uid ||
                              user.email?.toLowerCase() === "qu22n98@gmail.com")
                          ) {
                            selectedMentee &&
                              startEditingMentee(selectedMentee);
                          }
                        }}
                        className={`w-24 h-24 bg-gradient-to-br from-[#4F46E5]/10 to-[#EC4899]/10 text-[#4F46E5] rounded-[32px] flex items-center justify-center text-3xl font-black shadow-inner border border-white overflow-hidden relative group/avatar ${user && (selectedMentee?.creatorId === user.uid || user.email?.toLowerCase() === "qu22n98@gmail.com") ? "cursor-pointer" : "cursor-default"}`}
                      >
                        {selectedMentee?.avatar ? (
                          <img
                            src={selectedMentee.avatar}
                            alt={selectedMentee.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          selectedMentee?.name.slice(0, 2)
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/avatar:opacity-100 transition-opacity flex items-center justify-center">
                          <Camera size={24} className="text-white" />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <h2 className="text-2xl font-black text-gray-900">
                        {selectedMentee?.name}
                      </h2>
                      {user &&
                        (selectedMentee?.creatorId === user.uid ||
                          user.email?.toLowerCase() ===
                            "qu22n98@gmail.com") && (
                          <div className="flex gap-0.5">
                            <button
                              onClick={() =>
                                selectedMentee &&
                                startEditingMentee(selectedMentee)
                              }
                              className="p-1.5 text-gray-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                              title="프로필 수정"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (selectedMentee)
                                  handleDeleteMentee(e, selectedMentee.id);
                              }}
                              className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                              title="삭제"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                    </div>
                    <p className="text-[#7C3AED] font-black text-[10px] uppercase tracking-widest mb-4">
                      {selectedMentee?.department}
                    </p>

                    {selectedMentee?.mentorName && (
                      <div className="mb-4 p-4 bg-gray-50/80 rounded-2xl w-full border border-white">
                        <p className="text-[10px] font-black text-gray-400 uppercase mb-2 tracking-widest">
                          Growth Mentor
                        </p>
                        <div className="flex items-center gap-3 justify-center">
                          <div className="text-left">
                            <p className="text-sm font-black text-gray-800">
                              {selectedMentee.mentorName}
                            </p>
                            <p className="text-[11px] text-gray-500 font-medium">
                              {selectedMentee.mentorDept}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="w-full grid grid-cols-3 gap-2 pt-4 border-t border-gray-50">
                      <div className="bg-indigo-50 p-2 rounded-xl border border-indigo-100 text-center">
                        <p className="text-[9px] font-black text-indigo-400 uppercase mb-1">
                          직무
                        </p>
                        <p className="text-sm font-bold text-indigo-700">
                          {stats?.job}
                        </p>
                      </div>
                      <div className="bg-rose-50 p-2 rounded-xl border border-rose-100 text-center">
                        <p className="text-[9px] font-black text-rose-400 uppercase mb-1">
                          사회
                        </p>
                        <p className="text-sm font-bold text-rose-700">
                          {stats?.psy}
                        </p>
                      </div>
                      <div className="bg-emerald-50 p-2 rounded-xl border border-emerald-100 text-center">
                        <p className="text-[9px] font-black text-emerald-400 uppercase mb-1">
                          PGD
                        </p>
                        <p className="text-sm font-bold text-emerald-700">
                          {stats?.pgd}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => setIsChecklistStatusModalOpen(true)}
                      className="w-full mt-4 py-3 rounded-2xl bg-gray-900 text-white text-xs font-black hover:bg-blue-600 transition-all flex items-center justify-center gap-2 shadow-lg shadow-gray-200"
                    >
                      <CheckCircle2 size={14} />
                      체크리스트 완료 현황
                    </button>

                    <div className="w-full mt-4 p-4 bg-gray-900 rounded-2xl text-left">
                      <p className="text-[10px] font-black text-gray-400 uppercase mb-3 tracking-widest flex justify-between items-center">
                        지원금 정산 현황
                        <span className="text-gray-500 font-normal normal-case">
                          Total 600,000₩
                        </span>
                      </p>
                      <div className="space-y-3">
                        <div>
                          <div className="flex justify-between items-end mb-1">
                            <p className="text-[11px] font-bold text-gray-300">
                              누적 사용금액
                            </p>
                            <p className="text-sm font-black text-white">
                              {(
                                selectedMentee?.activities.reduce(
                                  (sum, a) => sum + (a.amountSpent || 0),
                                  0,
                                ) || 0
                              ).toLocaleString()}
                              ₩
                            </p>
                          </div>
                          <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{
                                width: `${Math.min(((selectedMentee?.activities.reduce((sum, a) => sum + (a.amountSpent || 0), 0) || 0) / 600000) * 100, 100)}%`,
                              }}
                              className="h-full bg-blue-500"
                            />
                          </div>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-gray-800">
                          <p className="text-[11px] font-bold text-gray-400">
                            잔액
                          </p>
                          <p className="text-sm font-black text-blue-400">
                            {(
                              600000 -
                              (selectedMentee?.activities.reduce(
                                (sum, a) => sum + (a.amountSpent || 0),
                                0,
                              ) || 0)
                            ).toLocaleString()}
                            ₩
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4 bg-white">
                    <div className="flex justify-between items-center pb-2 border-b border-gray-50">
                      <h3 className="font-bold text-gray-800 flex items-center gap-2">
                        <Plus size={18} className="text-blue-600" />
                        활동 내역 추가
                      </h3>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <p className="text-[10px] font-black text-gray-400 uppercase mb-2 tracking-widest">
                          일자
                        </p>
                        <input
                          type="date"
                          value={actDate}
                          onChange={(e) => setActDate(e.target.value)}
                          min="2026-05-27"
                          max="2026-11-30"
                          className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2 px-4 text-xs focus:ring-2 focus:ring-blue-500 outline-none transition-all font-sans"
                        />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-gray-400 uppercase mb-2 tracking-widest">
                          분류 및 체크리스트
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {(
                            [
                              "직무연관",
                              "심리사회",
                              "Purpose/Global/Digital",
                            ] as const
                          ).map((cat) => (
                            <button
                              key={cat}
                              onClick={() => {
                                setCurrentCategory(cat);
                                setIsChecklistModalOpen(true);
                              }}
                              className={`px-3 py-2 rounded-xl text-[10px] font-black transition-all border-2 flex items-center gap-2 ${
                                currentCategory === cat
                                  ? cat === "심리사회"
                                    ? "bg-rose-600 border-rose-600 text-white shadow-md"
                                    : cat === "Purpose/Global/Digital"
                                      ? "bg-emerald-600 border-emerald-600 text-white shadow-md"
                                      : "bg-blue-600 border-blue-600 text-white shadow-md"
                                  : "bg-white border-gray-100 text-gray-400 hover:border-blue-200"
                              }`}
                            >
                              <Plus size={12} />
                              {cat}
                            </button>
                          ))}
                        </div>
                        {selectedChecklistItemId && (
                          <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-center justify-between gap-3">
                            <div className="flex-grow">
                              <p className="text-[9px] font-black text-blue-400 uppercase mb-0.5">
                                선택된 항목
                              </p>
                              <p className="text-[11px] font-bold text-blue-700 leading-tight">
                                {
                                  MENTORING_CHECKLIST[currentCategory].find(
                                    (i) => i.id === selectedChecklistItemId,
                                  )?.title
                                }
                              </p>
                            </div>
                            <button
                              onClick={() => {
                                setSelectedChecklistItemId(null);
                                setActContent("");
                              }}
                              className="p-1.5 text-blue-400 hover:text-blue-600 bg-white rounded-lg shadow-sm"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-gray-400 uppercase mb-2 tracking-widest">
                          금액 (선택사항)
                        </p>
                        <input
                          type="number"
                          placeholder="숫자만 입력"
                          value={actAmount}
                          onChange={(e) => setActAmount(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-100 rounded-xl py-2 px-4 text-xs focus:ring-2 focus:ring-blue-500 outline-none transition-all font-sans"
                        />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-gray-400 uppercase mb-2 tracking-widest">
                          증빙 사진
                        </p>
                        <div
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const file = e.dataTransfer.files?.[0];
                            if (file && file.type.startsWith("image/")) {
                              compressImage(file, 800, 600)
                                .then((compressed) => {
                                  setActImage(compressed);
                                })
                                .catch((err) =>
                                  console.error("Compression failed", err),
                                );
                            }
                          }}
                          className={`w-full bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl p-4 transition-all hover:bg-gray-100/50 flex flex-col items-center justify-center gap-2 group relative cursor-pointer`}
                          onClick={() => {
                            const input = document.createElement("input");
                            input.type = "file";
                            input.accept = "image/*";
                            input.onchange = (e) => {
                              const file = (e.target as HTMLInputElement)
                                .files?.[0];
                              if (file) {
                                compressImage(file, 800, 600)
                                  .then((compressed) => {
                                    setActImage(compressed);
                                  })
                                  .catch((err) =>
                                    console.error("Compression failed", err),
                                  );
                              }
                            };
                            input.click();
                          }}
                        >
                          {actImage ? (
                            <div className="relative w-full aspect-video rounded-xl overflow-hidden shadow-inner">
                              <img
                                src={actImage}
                                alt="Preview"
                                className="w-full h-full object-cover"
                              />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActImage("");
                                }}
                                className="absolute top-2 right-2 bg-black/50 text-white p-1 rounded-lg hover:bg-black transition-colors"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center py-2">
                              <Camera
                                size={24}
                                className="text-gray-300 group-hover:text-blue-500 transition-colors mb-2"
                              />
                              <p className="text-[10px] font-bold text-gray-400">
                                사진을 드래그하거나 클릭하여 첨부
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-gray-400 uppercase mb-2 tracking-widest">
                          활동 내용
                        </p>
                        <textarea
                          placeholder="어떤 활동을 했나요? 리스트 외 활동도 자유롭게 입력하세요."
                          value={actContent}
                          onChange={(e) => setActContent(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-3 px-4 text-xs focus:ring-2 focus:ring-blue-500 outline-none transition-all min-h-[80px] font-medium"
                        />
                      </div>
                      {selectedMentee &&
                        (selectedMentee.creatorId === user.uid ||
                          user.email?.toLowerCase() ===
                            "qu22n98@gmail.com") && (
                          <button
                            onClick={handleAddActivity}
                            disabled={isAddingActivity}
                            className={`w-full text-white rounded-xl py-3 font-bold text-sm shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${
                              isAddingActivity
                                ? "bg-gray-400 cursor-not-allowed"
                                : "bg-blue-600 hover:bg-blue-700 shadow-blue-100"
                            }`}
                          >
                            {isAddingActivity && (
                              <RefreshCw size={16} className="animate-spin" />
                            )}
                            {isAddingActivity ? "기록 중..." : "활동 저장"}
                          </button>
                        )}
                    </div>
                  </div>
                </div>

                {/* AI Summary & History */}
                <div className="md:w-2/3 xl:w-3/4 space-y-8">
                  <div className="bg-blue-600 rounded-3xl p-8 text-white relative overflow-hidden shadow-lg">
                    <div className="relative z-10">
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
                        <div className="flex items-center gap-4">
                          <div className="bg-white/20 p-2 rounded-xl">
                            <Zap size={24} className="text-yellow-300" />
                          </div>
                          <div>
                            <h3 className="text-xl font-bold">
                              재미로 보는 AI 리포트 ✨
                            </h3>
                            <p className="text-blue-100 text-xs font-medium opacity-80">
                              AI가 분석한 나의 멘티 성장 캐릭터
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={handleGenerateAI}
                          disabled={
                            isGeneratingSummary ||
                            selectedMentee?.activities.length === 0
                          }
                          className="bg-white text-blue-600 px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-blue-50 transition-all shadow-md active:scale-95 disabled:opacity-50"
                        >
                          {isGeneratingSummary ? (
                            <>
                              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                              분석 중...
                            </>
                          ) : (
                            <>
                              <Sparkles size={16} />
                              AI 리포트 생성하기
                            </>
                          )}
                        </button>
                      </div>

                      {selectedMentee?.aiSummary ? (
                        <div className="relative">
                          {/* Character Hero Section - Simplified */}
                          <div className="bg-gradient-to-br from-indigo-900/60 to-blue-900/40 rounded-[32px] border border-white/20 backdrop-blur-xl p-6 overflow-hidden relative">
                            {/* Decorative Elements */}
                            <div className="absolute -top-24 -right-24 w-64 h-64 bg-blue-500/10 blur-[80px] rounded-full" />

                            <div className="flex flex-col items-center md:items-start gap-4 relative z-10">
                              <div className="w-full text-center md:text-left">
                                <div className="inline-flex items-center gap-2 bg-blue-400/20 px-3 py-1 rounded-full mb-2 border border-blue-400/30">
                                  <span className="text-[10px] font-black text-blue-200 tracking-wider">
                                    성장 캐릭터 타입
                                  </span>
                                </div>
                                <h3 className="text-2xl font-black text-white mb-3 tracking-tighter">
                                  {selectedMentee.aiCharacterName ||
                                    "성장하는 아기 새"}
                                </h3>
                                <div className="flex flex-wrap justify-center md:justify-start gap-1.5">
                                  {selectedMentee.aiSummary
                                    .split(",")
                                    .map((kw, i) => (
                                      <span
                                        key={i}
                                        className="bg-white/10 px-3 py-1 rounded-lg text-[11px] font-bold border border-white/10 text-blue-100"
                                      >
                                        #{kw.trim()}
                                      </span>
                                    ))}
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 pt-6 border-t border-white/10">
                              {/* Quests - Compact */}
                              <div>
                                <div className="flex items-center gap-2 mb-3">
                                  <Compass
                                    size={14}
                                    className="text-amber-300"
                                  />
                                  <span className="text-[9px] font-black text-blue-200 uppercase tracking-widest">
                                    다음 성장 퀘스트
                                  </span>
                                </div>
                                <div className="space-y-2">
                                  {selectedMentee.aiRecommendations?.map(
                                    (rec, i) => (
                                      <div
                                        key={i}
                                        className="bg-white/5 rounded-xl p-2.5 border border-white/5 flex items-center gap-2.5"
                                      >
                                        <div className="w-5 h-5 bg-amber-400/20 rounded-md flex items-center justify-center text-[9px] font-black text-amber-300 shrink-0">
                                          {i + 1}
                                        </div>
                                        <span className="text-[11px] font-medium text-white/90 truncate">
                                          {rec}
                                        </span>
                                      </div>
                                    ),
                                  )}
                                </div>
                              </div>

                              {/* Support - Compact */}
                              <div className="flex flex-col justify-end">
                                <div className="bg-white/5 rounded-2xl p-4 border border-white/5 relative italic">
                                  <div className="absolute top-0 left-4 -translate-y-1/2">
                                    <div className="bg-rose-500 p-1.5 rounded-lg shadow-lg">
                                      <Heart size={14} className="text-white" />
                                    </div>
                                  </div>
                                  <p className="text-[12px] leading-relaxed text-blue-50 font-medium pt-1">
                                    "{selectedMentee.aiFeedback}"
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Re-generate Button (Minimized) */}
                          <button
                            onClick={handleGenerateAI}
                            className="absolute bottom-4 right-4 text-[10px] items-center gap-1 font-bold text-white/40 hover:text-white/80 transition-colors flex"
                          >
                            <RefreshCw size={10} />
                            리포트 갱신
                          </button>
                        </div>
                      ) : (
                        <div className="bg-white/5 border border-dashed border-white/20 rounded-xl p-6 text-center text-blue-100/50">
                          <p className="text-xs font-bold text-blue-100">
                            등록된 활동 내용을 바탕으로 요약과 인사이트를
                            제공합니다.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* History Section */}
                  <div className="space-y-4">
                    <div className="bg-blue-50/50 p-6 rounded-3xl border border-blue-100 mb-6">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                        <h3 className="text-lg font-black flex items-center gap-2 text-gray-900">
                          활동 히스토리
                        </h3>
                        <div className="flex bg-gray-200/50 p-1 rounded-xl border border-gray-200 shadow-inner">
                          <button
                            onClick={() => setViewMode("list")}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-black transition-all ${
                              viewMode === "list"
                                ? "bg-blue-600 text-white shadow-lg shadow-blue-200"
                                : "text-gray-500 hover:text-gray-700"
                            }`}
                          >
                            <LayoutGrid size={12} />
                            리스트
                          </button>
                          <button
                            onClick={() => setViewMode("calendar")}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-black transition-all ${
                              viewMode === "calendar"
                                ? "bg-blue-600 text-white shadow-lg shadow-blue-200"
                                : "text-gray-500 hover:text-gray-700"
                            }`}
                          >
                            <CalendarIcon size={12} />
                            캘린더
                          </button>
                        </div>
                      </div>

                      {/* Phase Filter Buttons */}
                      <div className="flex flex-wrap gap-2">
                        {[
                          { id: "all", label: "전체 활동" },
                          { id: "Phase1", label: "Phase 1 (6-7월)" },
                          { id: "Phase2", label: "Phase 2 (8-9월)" },
                          { id: "Phase3", label: "Phase 3 (10-11월)" },
                        ].map((phase) => (
                          <button
                            key={phase.id}
                            onClick={() => setActivePhase(phase.id as any)}
                            className={`px-4 py-2 rounded-xl text-[11px] font-bold transition-all border ${
                              activePhase === phase.id
                                ? "bg-white border-blue-200 text-blue-600 shadow-sm"
                                : "bg-transparent border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                            }`}
                          >
                            {phase.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-6">
                      {(() => {
                        const allActivities = selectedMentee?.activities || [];
                        const filteredActivities = allActivities.filter(
                          (act) => {
                            if (activePhase === "all") return true;
                            const period = getBiMonthlyPeriod(
                              parseDateSafe(act.date),
                            );
                            if (!period) return false;

                            if (activePhase === "Phase1")
                              return period.name === "6월-7월";
                            if (activePhase === "Phase2")
                              return period.name === "8월-9월";
                            if (activePhase === "Phase3")
                              return period.name === "10월-11월";
                            return true;
                          },
                        );

                        if (viewMode === "calendar") {
                          return (
                            <CalendarView
                              targetActivities={filteredActivities.map((a) => ({
                                ...a,
                                menteeName: selectedMentee?.name,
                                menteeId: selectedMentee?.id,
                              }))}
                            />
                          );
                        }

                        if (filteredActivities.length === 0) {
                          return (
                            <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-20 flex flex-col items-center justify-center text-gray-400 text-center">
                              <ClipboardList
                                size={48}
                                className="mb-4 opacity-10"
                              />
                              <p className="font-medium text-sm">
                                {activePhase === "all"
                                  ? "아직 등록된 활동이 없습니다."
                                  : `${activePhase === "Phase1" ? "Phase 1 (6-7월)" : activePhase === "Phase2" ? "Phase 2 (8-9월)" : "Phase 3 (10-11월)"} 기간에 등록된 활동이 없습니다.`}
                                <br />
                                {activePhase === "all" &&
                                  "왼쪽 폼에서 첫 활동을 추가해보세요!"}
                              </p>
                            </div>
                          );
                        }

                        return filteredActivities.map((act) => (
                          <motion.div
                            layout
                            key={act.id}
                            onClick={() =>
                              setActivityDetail({
                                ...act,
                                menteeName: selectedMentee?.name || "",
                                menteeId: selectedMentee?.id || "",
                              })
                            }
                            className="bg-white p-7 rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg hover:border-blue-100 transition-all cursor-pointer group relative overflow-hidden"
                          >
                            <div
                              className={`absolute top-0 left-0 w-2.5 h-full ${
                                act.category === "직무연관"
                                  ? "bg-indigo-500"
                                  : act.category === "심리사회"
                                    ? "bg-rose-500"
                                    : "bg-emerald-500"
                              }`}
                            ></div>
                            <div className="flex justify-between items-start mb-5">
                              <div className="flex items-center gap-3">
                                <span
                                  className={`px-5 py-2 rounded-2xl text-[10px] font-black tracking-widest uppercase ${
                                    act.category === "직무연관"
                                      ? "bg-indigo-50 text-indigo-700"
                                      : act.category === "심리사회"
                                        ? "bg-rose-50 text-rose-700"
                                        : "bg-emerald-50 text-emerald-700 font-sans"
                                  }`}
                                >
                                  {act.category}
                                </span>
                                {act.amountSpent > 0 && (
                                  <span className="px-5 py-2 bg-gray-50 border border-gray-100 rounded-2xl text-[10px] font-black text-gray-500">
                                    {act.amountSpent.toLocaleString()}₩
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-400 font-black tracking-wide pr-12">
                                  {formatDate(act.date)}
                                </span>
                                {act.checklistItemId && (
                                  <div className="absolute top-6 right-6 w-10 h-10 bg-yellow-400 rounded-2xl flex items-center justify-center text-white shadow-lg animate-bounce-subtle group-hover:scale-110 transition-transform z-10">
                                    <Sparkles
                                      size={20}
                                      className="fill-white"
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                            <p className="text-gray-900 leading-relaxed whitespace-pre-wrap font-medium line-clamp-5 text-sm">
                              {act.content}
                            </p>

                            {act.image && (
                              <div className="mt-4 rounded-xl overflow-hidden border border-gray-100 shadow-inner">
                                <img
                                  src={act.image}
                                  alt="활동 사진"
                                  className="w-full h-auto object-contain"
                                />
                              </div>
                            )}

                            <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-all flex gap-1">
                              {user &&
                                (act.creatorId === user.uid ||
                                  user.email?.toLowerCase() ===
                                    "qu22n98@gmail.com") && (
                                  <>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        startEditingActivity(act);
                                      }}
                                      className="p-2.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                                      title="수정"
                                    >
                                      <Pencil size={18} />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteActivity(
                                          e,
                                          act.id,
                                          selectedMentee.id,
                                        );
                                      }}
                                      className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                      title="삭제"
                                    >
                                      <Trash2 size={18} />
                                    </button>
                                  </>
                                )}
                            </div>

                            <div className="mt-6 flex items-center justify-between border-t border-gray-50 pt-4">
                              <div className="flex items-center gap-4">
                                <button
                                  onClick={(e) =>
                                    handleLike(e, selectedMentee.id, act.id)
                                  }
                                  className={`flex items-center gap-1.5 transition-all text-xs font-black px-3 py-1.5 rounded-full ${
                                    (act.likedBy ?? []).includes(user?.uid)
                                      ? "bg-rose-50 text-rose-600"
                                      : "bg-white text-gray-400 hover:bg-gray-50"
                                  }`}
                                >
                                  <ThumbsUp
                                    size={14}
                                    className={
                                      (act.likedBy ?? []).includes(user?.uid)
                                        ? "fill-rose-600"
                                        : ""
                                    }
                                  />
                                  {(act.likedBy ?? []).length}
                                </button>
                                <div className="flex items-center gap-1.5 text-gray-400 text-xs font-black">
                                  <MessageCircle size={14} />
                                  {(act.comments ?? []).length}
                                </div>
                              </div>
                              <div className="flex items-center -space-x-2">
                                {(act.likedBy ?? []).slice(0, 3).map((u, i) => (
                                  <div
                                    key={i}
                                    className="w-6 h-6 rounded-full bg-blue-100 border-2 border-white flex items-center justify-center text-[8px] font-bold text-blue-600 ring-1 ring-blue-50"
                                  >
                                    나
                                  </div>
                                ))}
                                {(act.likedBy ?? []).length > 3 && (
                                  <div className="w-6 h-6 rounded-full bg-gray-50 border-2 border-white flex items-center justify-center text-[8px] font-bold text-gray-400 ring-1 ring-gray-100">
                                    +{(act.likedBy ?? []).length - 3}
                                  </div>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        ));
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : mainTab === "calendar" ? (
            <motion.div
              key="calendar-tab"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between bg-blue-600 p-8 rounded-3xl text-white shadow-xl overflow-hidden relative">
                <div className="absolute top-0 right-0 p-8 opacity-10">
                  <CalendarIcon size={120} />
                </div>
                <div className="relative z-10">
                  <h2 className="text-3xl font-black mb-2">전체 활동 일정</h2>
                  <p className="text-blue-100 font-medium">
                    모든 인원의 활동을 월별 캘린더로 확인하세요.
                  </p>
                </div>
              </div>
              <CalendarView targetActivities={allActivities} />
            </motion.div>
          ) : (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
                {/* Hall of Fame - Compact */}
                <motion.section
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="lg:col-span-1 bg-gradient-to-br from-amber-50 to-orange-50 p-6 rounded-[2.5rem] border border-amber-100 shadow-xl shadow-amber-900/5 relative overflow-hidden flex flex-col"
                >
                  <div className="absolute top-[-20%] right-[-20%] w-40 h-40 bg-amber-200/20 blur-3xl rounded-full" />
                  
                  <div className="flex items-center gap-2 mb-4 relative z-10">
                    <div className="w-8 h-8 bg-amber-400 rounded-xl flex items-center justify-center text-white shadow-lg shadow-amber-200/50">
                      <Trophy size={16} />
                    </div>
                    <h2 className="text-sm font-black text-amber-900 tracking-tighter">
                      5월 명예의 전당
                    </h2>
                  </div>

                  <div className="space-y-4 flex-1 flex flex-col justify-center">
                    {[
                      { label: "활동왕", data: hallOfFame.activityKing, icon: "🔥", color: "text-orange-600" },
                      { label: "댓글왕", data: hallOfFame.commentKing, icon: "💬", color: "text-blue-600" },
                      { label: "공감왕", data: hallOfFame.likeKing, icon: "❤️", color: "text-rose-600" },
                    ].map((king, idx) => (
                      <div key={idx} className="bg-white/60 backdrop-blur-sm p-3 rounded-2xl border border-white/50 flex items-center gap-3 group hover:scale-[1.02] transition-transform">
                        <div className="text-xl">{king.icon}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-black text-gray-400 uppercase leading-none mb-1">
                            {king.label}
                          </p>
                          <p className={`text-xs font-black truncate ${king.color}`}>
                            {king.data ? king.data.name : "주인공 대기 중"}
                          </p>
                        </div>
                        {king.data && (
                          <div className="bg-white px-2 py-0.5 rounded-lg text-[9px] font-black text-gray-400 border border-gray-100">
                            {king.data.count}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.section>

                <section className="lg:col-span-3 relative overflow-hidden">
                  <div className="relative h-full">
                    <div className="h-full bg-white/95 backdrop-blur-md p-6 rounded-[2.5rem] border border-white shadow-2xl shadow-blue-900/10 flex flex-col justify-start gap-4 relative overflow-hidden">
                      {/* Decorative Blob */}
                      <div className="absolute top-[-10%] right-[-5%] w-[300px] h-[300px] bg-blue-50/50 blur-[80px] rounded-full pointer-events-none" />

                      <div className="flex items-center justify-between overflow-x-auto pb-1 scrollbar-hide relative z-10">
                        <div>
                          <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
                            <TrendingUp className="text-blue-600" size={24} />
                            멘토링 활동 현황
                          </h2>
                        </div>
                        <div className="flex gap-4 items-center">
                          {user &&
                            user.email?.toLowerCase() === "qu22n98@gmail.com" && (
                              <button
                                onClick={handleResetAllData}
                                disabled={isResetting}
                                className={`px-3 py-1.5 rounded-xl text-[10px] font-black tracking-widest transition-all disabled:opacity-50 flex items-center gap-2 ${
                                  resetConfirmCount === 1
                                    ? "bg-red-600 text-white animate-pulse"
                                    : "bg-red-50 hover:bg-red-100 text-red-600"
                                }`}
                              >
                                {isResetting ? (
                                  <RefreshCw size={12} className="animate-spin" />
                                ) : resetConfirmCount === 1 ? (
                                  <AlertCircle size={12} />
                                ) : (
                                  <Trash2 size={12} />
                                )}
                                {isResetting
                                  ? "초기화 중..."
                                  : resetConfirmCount === 1
                                    ? "진짜 초기화? (클릭)"
                                    : "전체 초기화"}
                              </button>
                            )}
                          <div className="bg-blue-50 px-3 py-1.5 rounded-xl text-blue-600 text-[10px] font-black tracking-widest uppercase">
                            LIVE UPDATE
                          </div>
                        </div>
                      </div>

                      {/* Global Overview Stats - Consolidated from the old top bar */}
                      <div className="grid grid-cols-3 gap-3 relative z-10">
                        {[
                          { 
                            label: "참여 인원", 
                            value: mentees.length, 
                            color: "text-blue-600", 
                            bg: "bg-blue-600/10",
                            border: "border-blue-200",
                            unit: "명",
                            icon: <Users size={14} className="text-blue-500/50" />
                          },
                          { 
                            label: "누적 활동", 
                            value: globalActivities.length, 
                            color: "text-emerald-600", 
                            bg: "bg-emerald-600/10",
                            border: "border-emerald-200",
                            unit: "건",
                            icon: <ClipboardList size={14} className="text-emerald-500/50" />
                          },
                          { 
                            label: "누적 댓글", 
                            value: allComments.length, 
                            color: "text-rose-600", 
                            bg: "bg-rose-600/10",
                            border: "border-rose-200",
                            unit: "개",
                            icon: <MessageCircle size={14} className="text-rose-500/50" />
                          },
                        ].map((s, i) => (
                          <div key={i} className={`${s.bg} backdrop-blur-sm p-4 rounded-2xl border ${s.border} shadow-sm relative overflow-hidden group hover:shadow-md transition-all`}>
                            <div className="absolute top-1 right-2 opacity-30 group-hover:scale-110 transition-transform">
                              {s.icon}
                            </div>
                            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5 truncate relative z-10">{s.label}</p>
                            <div className="flex items-baseline gap-0.5 relative z-10">
                              <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                              <span className={`text-xs font-bold ${s.color} opacity-60`}>{s.unit}</span>
                            </div>
                            {/* Subtle inner pattern */}
                            <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-white opacity-20 blur-xl pointer-events-none" />
                          </div>
                        ))}
                      </div>

                      <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-5 border border-white shadow-sm relative overflow-hidden group">
                        <div className="flex items-center justify-between mb-3 relative z-10">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-rose-100 rounded-xl flex items-center justify-center text-rose-600">
                              <Zap size={16} className="fill-current" />
                            </div>
                            <div>
                              <h3 className="text-xs font-black text-gray-900 uppercase tracking-[0.1em]">
                                전체 여정 진행률
                              </h3>
                            </div>
                          </div>
                          <div className="text-lg font-black text-rose-600">
                            {mentoringProgress.status} (
                            {mentoringProgress.progress}%)
                          </div>
                        </div>
                        <div className="relative h-4 bg-gray-200/50 rounded-full p-0.5 border border-white overflow-hidden shadow-inner">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${mentoringProgress.progress}%` }}
                            className="h-full bg-gradient-to-r from-orange-400 via-rose-500 to-purple-600 rounded-full relative shadow-lg"
                          >
                            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/white-diamond.png')] opacity-20" />
                          </motion.div>
                        </div>
                        <div className="mt-2 flex justify-between px-1">
                          <span className="text-[9px] font-bold text-gray-400">
                            2026.05.27 시작
                          </span>
                          <span className="text-[9px] font-bold text-rose-500 animate-pulse">
                            우리 모두 성장 중! ✨
                          </span>
                          <span className="text-[9px] font-bold text-gray-400">
                            2026.11.30 종료
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Recent Feed - Now Integrated */}
                <div className="lg:col-span-7 bg-white/60 backdrop-blur-sm rounded-[2.5rem] p-8 border border-white/50 shadow-xl shadow-blue-900/5">
                  <div className="flex items-center justify-between mb-8 overflow-hidden">
                    <h2 className="text-lg font-black flex items-center gap-2 text-gray-900 border-b-2 border-blue-100 pb-1">
                      <TrendingUp size={20} className="text-blue-600" />
                      최근 활동 피드
                    </h2>
                    <div className="flex gap-1">
                      <span className="text-[10px] font-bold text-gray-400 uppercase">
                        최신순
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {allActivities.length === 0 ? (
                      <p className="text-center py-8 text-gray-400 italic text-sm col-span-2">
                        표시할 활동이 없습니다.
                      </p>
                    ) : (
                      allActivities.slice(0, 6).map((act) => (
                        <motion.div
                          key={act.id}
                          whileHover={{
                            x: 4,
                            backgroundColor: "rgba(255, 255, 255, 0.8)",
                          }}
                          onClick={() => setActivityDetail(act)}
                          className="relative pl-6 border-l-2 border-blue-100 last:border-l-2 pb-2 cursor-pointer group/item transition-all rounded-r-2xl p-4 bg-white/30 border border-white/40"
                        >
                          <div className="absolute -left-[9px] top-6 w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-sm group-hover/item:scale-110 transition-transform"></div>
                          <div>
                            <p className="text-[10px] text-gray-400 mb-1 font-medium">
                              {formatDate(act.date)}
                            </p>
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-bold text-blue-600 group-hover/item:underline">
                                {act.menteeName}
                              </p>
                              {act.mentorName && (
                                <span className="text-[10px] text-gray-400 font-medium font-sans">
                                  ({act.mentorName})
                                </span>
                              )}
                            </div>
                            <p className="text-xs font-semibold mt-1 line-clamp-1 text-gray-700">
                              {act.content}
                            </p>
                            <div className="flex items-center justify-between mt-2">
                              <span
                                className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${
                                  act.category === "직무연관"
                                    ? "bg-indigo-50 text-indigo-600"
                                    : act.category === "심리사회"
                                      ? "bg-rose-50 text-rose-600"
                                      : "bg-emerald-50 text-emerald-600"
                                }`}
                              >
                                {act.category}
                              </span>
                              <div className="flex items-center gap-2 text-[9px] font-bold text-gray-400">
                                <span className="flex items-center gap-1 font-sans">
                                  <Heart
                                    size={8}
                                    className="fill-rose-500 text-rose-500"
                                  />{" "}
                                  {(act.likedBy ?? []).length}
                                </span>
                                <span className="flex items-center gap-1 font-sans">
                                  <MessageCircle size={8} />{" "}
                                  {/* In global feed we might not have comments array loaded yet, so handle gracefully */}
                                  {act.comments?.length || 0}
                                </span>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))
                    )}
                  </div>
                  <button
                    onClick={() => setMainTab("calendar")}
                    className="w-full mt-6 py-3 bg-white/50 border border-white rounded-2xl text-xs font-black text-blue-600 hover:bg-blue-50 transition-all flex items-center justify-center gap-2 shadow-sm"
                  >
                    <CalendarIcon size={14} />
                    전체 타임라인 보기
                  </button>
                </div>

                <div className="lg:col-span-5 space-y-6 flex flex-col">
                  <div className="bg-white/60 backdrop-blur-sm rounded-[2.5rem] p-8 border border-white/50 shadow-xl shadow-blue-900/5 flex flex-col h-full overflow-hidden">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 shadow-inner">
                          <MessageCircle size={18} />
                        </div>
                        <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">
                          실시간 코멘트 피드
                        </h3>
                      </div>
                      <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-ping" />
                        <span className="text-[10px] font-bold text-red-500 uppercase">
                          Live
                        </span>
                      </div>
                    </div>

                    <div className="flex-1 overflow-hidden relative">
                      <div className="space-y-3">
                        {allComments.slice(0, 10).map((comment, idx) => {
                          const dateObj = parseDateSafe(comment.date);
                          return (
                            <motion.div
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: idx * 0.05 }}
                              key={comment.id}
                              className="flex gap-3 items-start bg-white/40 p-3 rounded-2xl border border-white/60 hover:bg-white/80 transition-all cursor-default group"
                            >
                              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-[10px] font-black shadow-sm shrink-0">
                                {comment.author
                                  ? comment.author.slice(0, 1)
                                  : "U"}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between mb-0.5">
                                  <p className="text-[11px] font-black text-gray-900 truncate">
                                    {comment.author}{" "}
                                    <span className="text-gray-400 font-medium ml-1">
                                      → {comment.menteeName}
                                    </span>
                                  </p>
                                  <span className="text-[9px] font-medium text-gray-400 shrink-0">
                                    {isValid(dateObj)
                                      ? format(dateObj, "MM.dd")
                                      : "방금 전"}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-600 font-medium line-clamp-1 group-hover:line-clamp-none transition-all">
                                  {comment.text}
                                </p>
                              </div>
                            </motion.div>
                          );
                        })}
                        {allComments.length === 0 && (
                          <div className="text-center py-10 opacity-30">
                            <MessageCircle className="mx-auto mb-2 text-gray-400" />
                            <p className="text-[10px] font-bold text-gray-500">
                              참여 중인 코멘트가 없습니다
                            </p>
                          </div>
                        )}

                      </div>
                      <div className="absolute bottom-0 left-0 w-full h-12 bg-gradient-to-t from-[#F8FAFC]/80 to-transparent pointer-events-none" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pb-12">
                {/* Mentee List - Now Full Width */}
                <section>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <h2 className="text-2xl font-black flex items-center gap-3 text-gray-900">
                      <div className="w-10 h-10 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600">
                        <Users size={22} />
                      </div>
                      활동 인원{" "}
                      <span className="text-blue-600 opacity-50">
                        ({sortedMentees.length})
                      </span>
                    </h2>
                    <div className="relative group">
                      <input
                        type="text"
                        placeholder="이름 또는 부서 검색..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full md:w-80 bg-white/80 backdrop-blur-sm border border-white rounded-[1.5rem] py-3 pl-12 pr-6 text-sm focus:ring-4 focus:ring-blue-500/10 outline-none transition-all shadow-lg"
                      />
                      <Users
                        size={18}
                        className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {sortedMentees.length === 0 ? (
                      <div className="col-span-full py-20 text-center bg-white/50 backdrop-blur-sm rounded-[3rem] border-4 border-dashed border-white shadow-xl text-gray-400">
                        <Users size={48} className="mx-auto mb-4 opacity-5" />
                        <p className="font-black text-xl">
                          검색 결과가 없습니다.
                        </p>
                        <p className="text-gray-300 mt-2 font-medium">
                          검색어를 다시 확인해주세요.
                        </p>
                      </div>
                    ) : (
                      sortedMentees.map((m) => {
                        const actCount = menteeActivityCounts[m.id] || 0;
                        const isTop = m.id === topMenteeId && actCount > 0;
                        const globalRank =
                          globalSortedMentees.findIndex(
                            (gm) => gm.id === m.id,
                          ) + 1;
                        const { progress, badge } = getBadgeInfo(actCount);
                        return (
                          <motion.div
                            key={m.id}
                            whileHover={{
                              y: -8,
                              shadow: "0 25px 50px -12px rgba(0, 0, 0, 0.1)",
                            }}
                            onClick={() => setSelectedMenteeId(m.id)}
                            className={`p-6 rounded-[2.5rem] border-2 transition-all group relative cursor-pointer ${
                              isTop
                                ? "bg-gradient-to-br from-amber-500 to-orange-600 text-white border-transparent"
                                : "bg-white/80 backdrop-blur-md border-white/60 shadow-xl shadow-gray-200/50"
                            }`}
                          >
                            {isTop && (
                              <div className="absolute -top-4 -right-2 bg-white text-orange-600 text-[10px] font-black px-4 py-2 rounded-full shadow-xl flex items-center gap-1 z-20 animate-bounce">
                                👑 BEST 우수사원
                              </div>
                            )}

                            <div className="flex justify-between items-start mb-6">
                              <div className="flex items-center gap-4">
                                <div className="relative">
                                  <div
                                    className={`w-16 h-16 rounded-[1.5rem] overflow-hidden border-2 shadow-xl flex items-center justify-center font-black text-lg ${
                                      isTop
                                        ? "border-white/50 bg-white/20 text-white"
                                        : "border-white bg-blue-50 text-blue-500"
                                    }`}
                                  >
                                    {m.avatar ? (
                                      <img
                                        src={m.avatar}
                                        alt={m.name}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      m.name.slice(0, 2)
                                    )}
                                  </div>
                                  {!isTop && (
                                    <div className="absolute -bottom-2 -right-2 bg-white w-8 h-8 rounded-xl shadow-lg flex items-center justify-center border border-gray-100">
                                      <span className="text-xs font-black text-blue-600">
                                        {globalRank}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <div>
                                  <p
                                    className={`text-[10px] font-black uppercase tracking-[0.2em] mb-1 ${isTop ? "text-white/70" : "text-gray-400"}`}
                                  >
                                    {m.department}
                                  </p>
                                  <h3 className="text-xl font-black truncate max-w-[120px]">
                                    {m.name}
                                  </h3>
                                </div>
                              </div>
                              <div
                                className={`border px-3 py-1.5 rounded-xl shadow-sm flex items-center gap-1.5 ${
                                  isTop
                                    ? "bg-white/20 border-white/30"
                                    : badge.bg + " " + badge.border
                                }`}
                              >
                                <span className="text-sm">{badge.icon}</span>
                                <span
                                  className={`text-[10px] font-black ${isTop ? "text-white" : badge.color}`}
                                >
                                  {badge.text}
                                </span>
                              </div>
                            </div>

                            {/* Detailed Category Stats */}
                            <div
                              className={`rounded-[1.5rem] p-4 mb-6 grid grid-cols-3 gap-2 transition-colors ${
                                isTop
                                  ? "bg-white/10"
                                  : "bg-gray-50/20 border border-gray-100"
                              }`}
                            >
                              {[
                                {
                                  label: "직무",
                                  value: globalActivities.filter(
                                    (a) =>
                                      a.menteeId === m.id &&
                                      a.category === "직무연관",
                                  ).length,
                                  color: isTop ? "text-white" : "text-indigo-600",
                                  dot: "bg-indigo-400",
                                },
                                {
                                  label: "사회",
                                  value: globalActivities.filter(
                                    (a) =>
                                      a.menteeId === m.id &&
                                      a.category === "심리사회",
                                  ).length,
                                  color: isTop ? "text-white" : "text-rose-600",
                                  dot: "bg-rose-400",
                                },
                                {
                                  label: "PGD",
                                  value: globalActivities.filter(
                                    (a) =>
                                      a.menteeId === m.id &&
                                      a.category ===
                                        "Purpose/Global/Digital",
                                  ).length,
                                  color: isTop
                                    ? "text-white"
                                    : "text-emerald-600",
                                  dot: "bg-emerald-400",
                                },
                              ].map((stat, idx) => (
                                <div key={idx} className="text-center relative">
                                  <div className="flex items-center justify-center gap-1 mb-1">
                                    <div
                                      className={`w-1.5 h-1.5 rounded-full ${stat.dot} ${isTop ? "bg-white" : ""}`}
                                    />
                                    <span
                                      className={`text-[10px] font-black uppercase tracking-tighter ${isTop ? "text-white/70" : "text-gray-400"}`}
                                    >
                                      {stat.label}
                                    </span>
                                  </div>
                                  <p
                                    className={`text-xl font-black ${stat.color}`}
                                  >
                                    {stat.value}
                                    <span className="text-[10px] opacity-50 ml-0.5">
                                      건
                                    </span>
                                  </p>
                                  {idx < 2 && (
                                    <div
                                      className={`absolute right-0 top-1/2 -translate-y-1/2 w-[1px] h-6 ${isTop ? "bg-white/10" : "bg-gray-200"}`}
                                    />
                                  )}
                                </div>
                              ))}
                            </div>

                            <div className="flex items-center justify-between">
                              <div
                                className={`flex items-center gap-2 text-[10px] font-bold px-3 py-1.5 rounded-full ${
                                  isTop
                                    ? "bg-white/20 text-white"
                                    : "bg-blue-50 text-blue-600"
                                }`}
                              >
                                <ClipboardList size={14} />
                                <span className="text-xs font-bold text-gray-400">
                                  기록 {menteeActivityCounts[m.id] || 0}건
                                </span>
                              </div>
                              {m.mentorName && (
                                <p
                                  className={`text-[9px] font-bold ${isTop ? "text-white/60" : "text-gray-300"}`}
                                >
                                  멘토:{" "}
                                  <span
                                    className={
                                      isTop ? "text-white" : "text-gray-500"
                                    }
                                  >
                                    {m.mentorName}
                                  </span>
                                </p>
                              )}
                            </div>
                          </motion.div>
                        );
                      })
                    )}
                  </div>
                </section>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modal: Activity Checklist Selection */}
      <AnimatePresence>
        {isChecklistModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsChecklistModalOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl relative z-10 flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
                <div>
                  <h3 className="text-xl font-black text-gray-900">
                    {currentCategory} 체크리스트
                  </h3>
                  <p className="text-xs text-gray-400 font-medium">
                    활동 항목 중 하나를 선택해 주세요.
                  </p>
                </div>
                <button
                  onClick={() => setIsChecklistModalOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
                >
                  <X size={20} className="text-gray-400" />
                </button>
              </div>

              <div className="flex-grow overflow-y-auto p-6 space-y-3 custom-scrollbar">
                {MENTORING_CHECKLIST[currentCategory].map((item) => {
                  const completionPeriod = getCheckCompletionStatus(
                    item.id,
                    actDate,
                  );
                  const isSelected = isEditModalOpen
                    ? editActData.checklistItemId === item.id
                    : selectedChecklistItemId === item.id;

                  return (
                    <motion.div
                      key={item.id}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => {
                        if (isEditModalOpen) {
                          setEditActData({
                            ...editActData,
                            checklistItemId: item.id,
                          });
                        } else {
                          setSelectedChecklistItemId(item.id);
                          setActContent(item.title);
                        }
                        setIsChecklistModalOpen(false);
                      }}
                      className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-start gap-3 ${
                        completionPeriod
                          ? "bg-amber-50/50 border-amber-100"
                          : isSelected
                            ? "bg-blue-50 border-blue-500 ring-4 ring-blue-50"
                            : "bg-white border-gray-100 hover:border-blue-200"
                      }`}
                    >
                      <div
                        className={`mt-1 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          completionPeriod
                            ? "bg-amber-500 border-amber-500 text-white"
                            : isSelected
                              ? "bg-blue-500 border-blue-500 text-white"
                              : "border-gray-200"
                        }`}
                      >
                        {(completionPeriod || isSelected) && (
                          <CheckCircle2 size={12} />
                        )}
                      </div>
                      <div className="flex-grow">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span
                            className={`text-[10px] font-black py-0.5 px-2 rounded-lg ${
                              completionPeriod
                                ? "bg-amber-100 text-amber-700"
                                : "bg-gray-100 text-gray-400"
                            }`}
                          >
                            {item.subCategory}
                          </span>
                          {completionPeriod && (
                            <span className="text-[10px] font-bold text-amber-600 flex items-center gap-1">
                              {completionPeriod} 완료됨
                            </span>
                          )}
                        </div>
                        <p
                          className={`text-sm font-bold leading-tight ${isSelected ? "text-blue-700" : "text-gray-700"}`}
                        >
                          {item.title}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              <div className="p-6 bg-gray-50 border-t border-gray-100">
                <button
                  onClick={() => {
                    if (isEditModalOpen) {
                      setEditActData({
                        ...editActData,
                        checklistItemId: undefined,
                        content: "",
                      });
                    } else {
                      setSelectedChecklistItemId(null);
                      setActContent("");
                    }
                    setIsChecklistModalOpen(false);
                  }}
                  className="w-full py-4 rounded-2xl border-2 border-dashed border-gray-300 text-sm font-black text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-all bg-white"
                >
                  + 리스트 외 자율 활동 직접 입력
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Mentee Checklist Status Overview */}
      <AnimatePresence>
        {isChecklistStatusModalOpen && selectedMentee && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsChecklistStatusModalOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-4xl rounded-[40px] overflow-hidden shadow-2xl relative z-10 flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-gray-100 flex items-center justify-between bg-white relative z-20">
                <div className="flex items-center gap-4">
                  <div className="vibrant-gradient p-4 rounded-2xl text-white shadow-xl animate-bounce-subtle">
                    <CheckCircle2 size={24} />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-gray-900 tracking-tight">
                      {selectedMentee.name} 성장 마일스톤
                    </h3>
                    <p className="text-[10px] text-indigo-500 font-black uppercase tracking-widest mt-1">
                      Bi-Monthly Achievement Tracking
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsChecklistStatusModalOpen(false)}
                  className="p-3 hover:bg-gray-100 rounded-2xl transition-all group border border-transparent hover:border-gray-200"
                >
                  <X
                    size={28}
                    className="text-gray-400 group-hover:text-gray-900 group-hover:rotate-90 transition-all"
                  />
                </button>
              </div>

              <div className="flex-grow overflow-y-auto p-0 custom-scrollbar bg-[#F8FAFC]">
                <div className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-gray-100 grid grid-cols-12 z-30">
                  <div className="col-span-6 p-6 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] border-r border-gray-50">
                    Core Objectives
                  </div>
                  {BI_MONTHLY_PERIODS.map((p) => (
                    <div
                      key={p.name}
                      className="col-span-2 p-6 text-[10px] font-black text-[#4F46E5] text-center uppercase tracking-widest border-r last:border-r-0 border-gray-50"
                    >
                      {p.name}
                    </div>
                  ))}
                </div>

                {(
                  ["직무연관", "심리사회", "Purpose/Global/Digital"] as const
                ).map((cat) => (
                  <div key={cat} className="mb-0">
                    <div
                      className={`p-4 text-[10px] font-black tracking-[0.3em] uppercase flex items-center gap-3 border-b border-gray-100 sticky top-[61px] z-20 backdrop-blur-md ${
                        cat === "직무연관"
                          ? "bg-indigo-50/90 text-indigo-700"
                          : cat === "심리사회"
                            ? "bg-rose-50/90 text-rose-700"
                            : "bg-emerald-50/90 text-emerald-700"
                      }`}
                    >
                      {cat === "Purpose/Global/Digital" ? (
                        <Globe size={14} />
                      ) : cat === "직무연관" ? (
                        <Briefcase size={14} />
                      ) : (
                        <Heart size={14} />
                      )}
                      {cat}
                    </div>
                    {MENTORING_CHECKLIST[cat].map((item) => (
                      <div
                        key={item.id}
                        className="grid grid-cols-12 border-b border-gray-50 bg-white hover:bg-indigo-50/30 transition-all group"
                      >
                        <div className="col-span-6 p-6 border-r border-gray-50 group-hover:pl-8 transition-all">
                          <p className="text-[9px] font-black text-gray-300 mb-1.5 uppercase tracking-widest">
                            {item.subCategory}
                          </p>
                          <p className="text-sm font-bold text-gray-700 leading-snug group-hover:text-[#4F46E5] transition-colors">
                            {item.title}
                          </p>
                        </div>
                        {BI_MONTHLY_PERIODS.map((p) => {
                          const isDone = selectedMentee.activities.some((a) => {
                            if (a.checklistItemId !== item.id) return false;
                            const aPeriod = getBiMonthlyPeriod(
                              new Date(a.date),
                            );
                            return aPeriod?.name === p.name;
                          });
                          return (
                            <div
                              key={p.name}
                              className="col-span-2 flex items-center justify-center p-6 border-r last:border-r-0 border-gray-50"
                            >
                              {isDone ? (
                                <motion.div
                                  initial={{ scale: 0, rotate: -45 }}
                                  animate={{ scale: 1, rotate: 0 }}
                                  className="w-12 h-12 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-100 border border-emerald-400"
                                >
                                  <CheckCircle2 size={24} strokeWidth={3} />
                                </motion.div>
                              ) : (
                                <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center text-gray-100 border border-gray-100 group-hover:border-indigo-100 transition-colors">
                                  <div className="w-4 h-1.5 bg-gray-100 rounded-full group-hover:bg-indigo-50 transition-colors" />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <div className="p-10 bg-white border-t border-gray-100 flex items-center justify-between gap-6 relative z-40">
                <div className="flex items-center gap-8">
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-lg bg-emerald-500 shadow-md shadow-emerald-100" />
                    <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest">
                      Achieved
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-lg bg-gray-100 border border-gray-200" />
                    <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest">
                      Pending
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setIsChecklistStatusModalOpen(false)}
                  className="vibrant-gradient text-white px-12 py-4 rounded-3xl font-black text-sm hover:scale-105 active:scale-95 transition-all shadow-2xl shadow-indigo-200"
                >
                  확인 완료
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setIsAddModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden relative z-10"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">
                  새로운 신입사원 등록
                </h2>
                <button
                  onClick={() => setIsAddModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    성함
                  </label>
                  <input
                    type="text"
                    value={newMentee.name}
                    onChange={(e) =>
                      setNewMentee((prev) => ({
                        ...prev,
                        name: e.target.value,
                      }))
                    }
                    placeholder="예: 홍길동"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    소속 부서
                  </label>
                  <input
                    type="text"
                    value={newMentee.dept}
                    onChange={(e) =>
                      setNewMentee((prev) => ({
                        ...prev,
                        dept: e.target.value,
                      }))
                    }
                    placeholder="예: 마케팅팀"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">
                      멘토 성함
                    </label>
                    <input
                      type="text"
                      value={newMentee.mentorName}
                      onChange={(e) =>
                        setNewMentee((prev) => ({
                          ...prev,
                          mentorName: e.target.value,
                        }))
                      }
                      placeholder="멘토 이름"
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">
                      멘토 소속/직함
                    </label>
                    <input
                      type="text"
                      value={newMentee.mentorDept}
                      onChange={(e) =>
                        setNewMentee((prev) => ({
                          ...prev,
                          mentorDept: e.target.value,
                        }))
                      }
                      placeholder="시니어 개발자 등"
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-sm mb-4"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">
                      활동 다짐
                    </label>
                    <textarea
                      value={newMentee.pledge}
                      onChange={(e) =>
                        setNewMentee((prev) => ({
                          ...prev,
                          pledge: e.target.value,
                        }))
                      }
                      placeholder="예: 즐겁고 유익한 멘토링이 될 수 있도록 최선을 다하겠습니다!"
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-sm resize-none h-20 mb-4"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">
                      프로필 이미지
                    </label>
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const file = e.dataTransfer.files?.[0];
                        if (file && file.type.startsWith("image/")) {
                          compressImage(file, 200, 200)
                            .then((compressed) => {
                              setNewMentee((prev) => ({
                                ...prev,
                                avatar: compressed,
                              }));
                            })
                            .catch((err) =>
                              console.error("Compression failed", err),
                            );
                        }
                      }}
                      className="w-full bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-4 transition-all hover:bg-gray-100/50 flex flex-col items-center justify-center gap-2 group relative cursor-pointer"
                      onClick={() => {
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = "image/*";
                        input.onchange = (e) => {
                          const file = (e.target as HTMLInputElement)
                            .files?.[0];
                          if (file) {
                            compressImage(file, 200, 200)
                              .then((compressed) => {
                                setNewMentee((prev) => ({
                                  ...prev,
                                  avatar: compressed,
                                }));
                              })
                              .catch((err) =>
                                console.error("Compression failed", err),
                              );
                          }
                        };
                        input.click();
                      }}
                    >
                      {newMentee.avatar ? (
                        <div className="relative w-20 h-20 rounded-full overflow-hidden shadow-inner">
                          <img
                            src={newMentee.avatar}
                            alt="Preview"
                            className="w-full h-full object-cover"
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setNewMentee((prev) => ({ ...prev, avatar: "" }));
                            }}
                            className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center py-2">
                          <Camera
                            size={24}
                            className="text-gray-300 group-hover:text-blue-500 transition-colors mb-2"
                          />
                          <p className="text-[10px] font-bold text-gray-400">
                            사진 드래그 또는 클릭
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 pt-6 pb-2">
                  <button
                    onClick={() => setIsAddModalOpen(false)}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-3 rounded-xl transition-all"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleAddMentee}
                    disabled={isRegisteringMentee}
                    className={`flex-1 vibrant-gradient text-white font-bold py-3 rounded-xl shadow-lg shadow-blue-100 transition-all font-sans flex items-center justify-center gap-2 ${isRegisteringMentee ? "opacity-70 cursor-not-allowed" : "hover:scale-[1.02]"}`}
                  >
                    {isRegisteringMentee ? (
                      <>
                        <RefreshCw className="animate-spin" size={18} />
                        등록 중...
                      </>
                    ) : (
                      "등록하기"
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Activity Detail Detail Popup */}
      <AnimatePresence>
        {activityDetail && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
              onClick={() => setActivityDetail(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 30 }}
              className="bg-white w-full max-w-5xl h-full max-h-[90vh] rounded-[32px] md:rounded-[48px] shadow-2xl overflow-hidden relative z-10 flex flex-col md:flex-row m-4"
            >
              <div className="w-full md:w-3/5 h-auto min-h-[300px] bg-gray-900 overflow-hidden relative flex-shrink-0 group flex items-center justify-center">
                <img
                  src={activityDetail.image}
                  alt="활동 증빙"
                  className="max-w-full max-h-full object-contain transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-8 left-8 flex flex-col gap-3">
                  <span
                    className={`text-[11px] uppercase font-black px-5 py-2.5 rounded-2xl tracking-[0.2em] shadow-xl backdrop-blur-md border border-white/20 ${
                      activityDetail.category === "직무연관"
                        ? "bg-indigo-600/90 text-white"
                        : activityDetail.category === "심리사회"
                          ? "bg-rose-600/90 text-white"
                          : "bg-emerald-600/90 text-white"
                    }`}
                  >
                    {activityDetail.category}
                  </span>
                  {activityDetail.checklistItemId && (
                    <div className="bg-yellow-400 text-white px-5 py-2.5 rounded-2xl flex items-center gap-2 shadow-xl animate-float">
                      <Sparkles size={16} className="fill-white" />
                      <span className="text-[11px] font-black uppercase tracking-widest">
                        Mastery Achieved
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="w-full md:w-2/5 flex flex-col min-h-0 bg-white">
                <div className="p-10 border-b border-gray-50 flex justify-between items-center bg-gray-50/30">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl vibrancy-gradient-bg flex items-center justify-center text-white shadow-lg vibrant-gradient">
                      <Zap size={24} />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-gray-900 tracking-tight">
                        {activityDetail.menteeName}
                      </h3>
                      <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mt-0.5">
                        {formatDate(activityDetail.date)}
                      </p>
                    </div>
                    {activityDetail.amountSpent > 0 && (
                      <div className="ml-2 bg-indigo-50 px-3 py-1.5 rounded-xl border border-indigo-100">
                        <span className="text-[10px] font-black text-indigo-600">
                          {activityDetail.amountSpent.toLocaleString()}₩
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {user &&
                      (activityDetail.creatorId === user.uid ||
                        user.email?.toLowerCase() === "qu22n98@gmail.com") && (
                        <button
                          onClick={(e) => {
                            handleDeleteActivity(
                              e,
                              activityDetail.id,
                              activityDetail.menteeId,
                            );
                            setActivityDetail(null);
                          }}
                          className="p-3 bg-red-50 text-red-600 rounded-2xl hover:bg-red-100 transition-all font-black text-[10px] flex flex-row items-center gap-2 whitespace-nowrap"
                          title="활동 삭제"
                        >
                          <Trash2 size={16} />
                          삭제
                        </button>
                      )}
                    <button
                      onClick={() => setActivityDetail(null)}
                      className="p-3 hover:bg-white hover:shadow-md rounded-2xl transition-all text-gray-400 hover:text-gray-900 group"
                    >
                      <X
                        size={24}
                        className="group-hover:rotate-90 transition-transform"
                      />
                    </button>
                  </div>
                </div>

                <div className="p-10 flex-grow overflow-y-auto custom-scrollbar">
                  <div className="mb-10">
                    <h4 className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-4">
                      활동 상세 내용
                    </h4>
                    <p className="text-gray-800 leading-relaxed whitespace-pre-wrap font-medium text-lg">
                      {activityDetail.content}
                    </p>
                  </div>

                  <div className="space-y-8 pt-10 border-t border-gray-50">
                    <div className="flex items-center gap-8">
                      <button
                        onClick={() => handleToggleLike(activityDetail)}
                        className={`flex items-center gap-2 text-sm font-black transition-all px-6 py-3 rounded-2xl shadow-sm ${
                          (activityDetail.likedBy ?? []).includes(user?.uid)
                            ? "bg-rose-500 text-white shadow-lg shadow-rose-200"
                            : "bg-gray-50 text-gray-400 hover:bg-gray-100 border border-gray-100"
                        }`}
                      >
                        <Heart
                          size={20}
                          className={
                            (activityDetail.likedBy ?? []).includes(user?.uid)
                              ? "fill-white"
                              : ""
                          }
                        />
                        <span>
                          {(activityDetail.likedBy ?? []).length} 공감
                        </span>
                      </button>
                      <div className="flex items-center gap-2 text-sm font-black text-gray-400 bg-gray-50 px-6 py-3 rounded-2xl border border-gray-100">
                        <MessageCircle size={20} />
                        <span>
                          {(activityDetail.comments ?? []).length} 댓글
                        </span>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {!activityDetail.comments ||
                      activityDetail.comments.length === 0 ? (
                        <p className="text-center py-4 text-gray-400 text-xs italic">
                          첫 댓글을 남겨보세요.
                        </p>
                      ) : (
                        activityDetail.comments.map((comment) => (
                          <div
                            key={comment.id}
                            className="bg-gray-50 p-4 rounded-2xl border border-gray-100 group/comment"
                          >
                            <div className="flex justify-between items-center mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-gray-900">
                                  {comment.author}
                                </span>
                                <span className="text-[10px] text-gray-400">
                                  {isValid(parseDateSafe(comment.date))
                                    ? format(
                                        parseDateSafe(comment.date),
                                        "M월 d일",
                                      )
                                    : "방금 전"}
                                </span>
                              </div>
                              {user &&
                                (comment.authorId === user.uid ||
                                  user.email?.toLowerCase() ===
                                    "qu22n98@gmail.com") &&
                                editingCommentId !== comment.id && (
                                  <div className="flex gap-2 opacity-0 group-hover/comment:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => {
                                        setEditingCommentId(comment.id);
                                        setEditCommentText(comment.text);
                                      }}
                                      className="text-[10px] font-bold text-blue-600 hover:underline"
                                    >
                                      수정
                                    </button>
                                    <button
                                      onClick={() =>
                                        handleDeleteComment(comment.id)
                                      }
                                      className="text-[10px] font-bold text-red-500 hover:underline"
                                    >
                                      삭제
                                    </button>
                                  </div>
                                )}
                            </div>

                            {editingCommentId === comment.id ? (
                              <div className="mt-2 space-y-2">
                                <textarea
                                  value={editCommentText}
                                  onChange={(e) =>
                                    setEditCommentText(e.target.value)
                                  }
                                  className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm min-h-[60px] outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium resize-none text-gray-700"
                                  autoFocus
                                />
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => setEditingCommentId(null)}
                                    className="text-[10px] font-bold text-gray-400 hover:text-gray-600"
                                  >
                                    취소
                                  </button>
                                  <button
                                    onClick={() =>
                                      handleUpdateComment(comment.id)
                                    }
                                    className="text-[10px] font-bold text-blue-600 hover:text-blue-700"
                                  >
                                    저장
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-gray-600 leading-relaxed">
                                {comment.text}
                              </p>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-6 border-t border-gray-50 bg-gray-50/30 flex flex-col gap-3">
                  <div className="relative">
                    <input
                      type="text"
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddComment()}
                      placeholder="댓글을 입력하세요..."
                      className="w-full bg-white border border-gray-200 rounded-full py-3 pl-5 pr-12 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                    />
                    <button
                      onClick={handleAddComment}
                      disabled={!newComment}
                      className="absolute right-2 top-1.5 p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      <Send size={16} />
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      setSelectedMenteeId(activityDetail.menteeId);
                      setActivityDetail(null);
                    }}
                    className="w-full bg-gray-900 hover:bg-black text-white py-2.5 rounded-full font-bold flex items-center justify-center gap-2 transition-all active:scale-95 text-xs"
                  >
                    이 멘티의 홈으로 가기
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Mentee Info Edit Modal */}
      <AnimatePresence>
        {isMenteeEditModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setIsMenteeEditModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl relative z-10 max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                  <UserPlus size={24} className="text-blue-500" />
                  사원 정보 수정
                </h2>
                <button
                  onClick={() => setIsMenteeEditModalOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                      이름
                    </label>
                    <input
                      type="text"
                      value={editMenteeData.name}
                      onChange={(e) =>
                        setEditMenteeData({
                          ...editMenteeData,
                          name: e.target.value,
                        })
                      }
                      className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-4 text-sm outline-none focus:ring-4 focus:ring-blue-100 focus:bg-white transition-all font-medium"
                      placeholder="사원 이름"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                      부서
                    </label>
                    <input
                      type="text"
                      value={editMenteeData.dept}
                      onChange={(e) =>
                        setEditMenteeData({
                          ...editMenteeData,
                          dept: e.target.value,
                        })
                      }
                      className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-4 text-sm outline-none focus:ring-4 focus:ring-blue-100 focus:bg-white transition-all font-medium"
                      placeholder="부서명"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-50">
                  <label className="block text-[10px] font-black text-blue-400 uppercase tracking-widest mb-2">
                    멘토 정보 (선택)
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <input
                        type="text"
                        value={editMenteeData.mentorName}
                        onChange={(e) =>
                          setEditMenteeData({
                            ...editMenteeData,
                            mentorName: e.target.value,
                          })
                        }
                        className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-4 text-sm outline-none focus:ring-4 focus:ring-blue-100 focus:bg-white transition-all font-medium"
                        placeholder="멘토 이름"
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        value={editMenteeData.mentorDept}
                        onChange={(e) =>
                          setEditMenteeData({
                            ...editMenteeData,
                            mentorDept: e.target.value,
                          })
                        }
                        className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-4 text-sm outline-none focus:ring-4 focus:ring-blue-100 focus:bg-white transition-all font-medium"
                        placeholder="멘토 부서"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-50">
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                    활동 다짐
                  </label>
                  <textarea
                    value={editMenteeData.pledge}
                    onChange={(e) =>
                      setEditMenteeData({
                        ...editMenteeData,
                        pledge: e.target.value,
                      })
                    }
                    className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-4 text-sm outline-none focus:ring-4 focus:ring-blue-100 focus:bg-white transition-all font-medium resize-none h-24"
                    placeholder="활동 다짐을 입력해주세요"
                  />
                </div>

                <div className="pt-4 border-t border-gray-50">
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                    프로필 이미지 업데이트
                  </label>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const file = e.dataTransfer.files?.[0];
                      if (file && file.type.startsWith("image/")) {
                        compressImage(file, 200, 200)
                          .then((compressed) => {
                            setEditMenteeData({
                              ...editMenteeData,
                              avatar: compressed,
                            });
                          })
                          .catch((err) =>
                            console.error("Compression failed", err),
                          );
                      }
                    }}
                    className="w-full bg-gray-50 border-2 border-dashed border-gray-100 rounded-2xl p-4 transition-all hover:bg-white flex flex-col items-center justify-center gap-2 group relative cursor-pointer"
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = "image/*";
                      input.onchange = (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (file) {
                          compressImage(file, 200, 200)
                            .then((compressed) => {
                              setEditMenteeData({
                                ...editMenteeData,
                                avatar: compressed,
                              });
                            })
                            .catch((err) =>
                              console.error("Compression failed", err),
                            );
                        }
                      };
                      input.click();
                    }}
                  >
                    {editMenteeData.avatar ? (
                      <div className="relative w-24 h-24 rounded-full overflow-hidden shadow-inner border border-gray-100">
                        <img
                          src={editMenteeData.avatar}
                          alt="Preview"
                          className="w-full h-full object-cover"
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditMenteeData({
                              ...editMenteeData,
                              avatar: "",
                            });
                          }}
                          className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                        >
                          <X size={20} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center py-4">
                        <Camera
                          size={28}
                          className="text-gray-300 group-hover:text-blue-500 transition-colors mb-2"
                        />
                        <p className="text-xs font-bold text-gray-400">
                          프로필 사진 드래그 또는 클릭
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-6 flex gap-3">
                  <button
                    onClick={() => setIsMenteeEditModalOpen(false)}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-4 rounded-2xl transition-all active:scale-95"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleUpdateMentee}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-100 transition-all active:scale-95"
                  >
                    수정 완료
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Activity Edit Modal */}
      <AnimatePresence>
        {isEditModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setIsEditModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl relative z-10 max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                  <Pencil size={24} className="text-blue-500" />
                  활동 수정
                </h2>
                <button
                  onClick={() => setIsEditModalOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                    카테고리
                  </label>
                  <div className="flex flex-row gap-2">
                    {(
                      [
                        "직무연관",
                        "심리사회",
                        "Purpose/Global/Digital",
                      ] as const
                    ).map((cat) => (
                      <button
                        key={cat}
                        onClick={() => {
                          setEditActData({ ...editActData, category: cat });
                          setCurrentCategory(cat);
                          setIsChecklistModalOpen(true);
                        }}
                        className={`flex-1 flex items-center justify-center gap-1 py-3 rounded-2xl border text-[10px] transition-all font-bold ${
                          editActData.category === cat
                            ? cat === "심리사회"
                              ? "bg-rose-600 border-rose-600 text-white shadow-lg shadow-rose-100"
                              : cat === "Purpose/Global/Digital"
                                ? "bg-emerald-600 border-emerald-600 text-white shadow-lg shadow-emerald-100"
                                : "bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100"
                            : "bg-gray-50 border-gray-100 text-gray-600 hover:bg-white"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                    내용
                  </label>
                  <textarea
                    value={editActData.content}
                    onChange={(e) =>
                      setEditActData({
                        ...editActData,
                        content: e.target.value,
                      })
                    }
                    className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-4 text-sm min-h-[150px] outline-none focus:ring-4 focus:ring-blue-100 focus:bg-white transition-all resize-none font-medium"
                    placeholder="활동 상세 내용을 입력하세요"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                    지출 금액 (₩)
                  </label>
                  <input
                    type="number"
                    value={editActData.amountSpent}
                    onChange={(e) =>
                      setEditActData({
                        ...editActData,
                        amountSpent: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-4 text-sm outline-none focus:ring-4 focus:ring-blue-100 focus:bg-white transition-all font-bold"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                    일정 업데이트 (선택)
                  </label>
                  <input
                    type="date"
                    value={editActData.date}
                    onChange={(e) =>
                      setEditActData({ ...editActData, date: e.target.value })
                    }
                    min="2026-05-27"
                    max="2026-11-30"
                    className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-4 text-sm outline-none focus:ring-4 focus:ring-blue-100 focus:bg-white transition-all font-medium"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                    증빙 사진 업데이트
                  </label>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const file = e.dataTransfer.files?.[0];
                      if (file && file.type.startsWith("image/")) {
                        compressImage(file, 800, 600)
                          .then((compressed) => {
                            setEditActData({
                              ...editActData,
                              image: compressed,
                            });
                          })
                          .catch((err) =>
                            console.error("Compression failed", err),
                          );
                      }
                    }}
                    className="w-full bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl p-4 transition-all hover:bg-gray-100/50 flex flex-col items-center justify-center gap-2 group relative cursor-pointer"
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = "image/*";
                      input.onchange = (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (file) {
                          compressImage(file, 800, 600)
                            .then((compressed) => {
                              setEditActData({
                                ...editActData,
                                image: compressed,
                              });
                            })
                            .catch((err) =>
                              console.error("Compression failed", err),
                            );
                        }
                      };
                      input.click();
                    }}
                  >
                    {editActData.image ? (
                      <div className="relative w-full aspect-video rounded-xl overflow-hidden shadow-inner">
                        <img
                          src={editActData.image}
                          alt="Preview"
                          className="w-full h-full object-cover"
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditActData({ ...editActData, image: "" });
                          }}
                          className="absolute top-2 right-2 bg-black/50 text-white p-1 rounded-lg hover:bg-black transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center py-4">
                        <Camera
                          size={28}
                          className="text-gray-300 group-hover:text-blue-500 transition-colors mb-2"
                        />
                        <p className="text-xs font-bold text-gray-400">
                          사진을 드래그하거나 클릭하여 첨부
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button
                    onClick={() => setIsEditModalOpen(false)}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-4 rounded-2xl transition-all active:scale-95"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleEditActivity}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-100 transition-all active:scale-95"
                  >
                    수정 완료
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Delete Confirmation Popup */}
      <AnimatePresence>
        {deleteConfirm.show && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() =>
                setDeleteConfirm({ ...deleteConfirm, show: false })
              }
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-sm rounded-[32px] p-8 shadow-2xl relative z-10 text-center"
            >
              <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <X size={32} />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                삭제 확인
              </h2>
              <p className="text-gray-500 text-sm leading-relaxed mb-8">
                {deleteConfirm.message}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() =>
                    setDeleteConfirm({ ...deleteConfirm, show: false })
                  }
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-4 rounded-2xl transition-all active:scale-95"
                >
                  취소
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-red-100 transition-all active:scale-95"
                >
                  삭제하기
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Global Alert Modal */}
      <AnimatePresence>
        {globalAlert.show && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
              onClick={() => setGlobalAlert({ ...globalAlert, show: false })}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-sm rounded-[32px] overflow-hidden shadow-2xl relative z-10"
            >
              <div
                className={`p-8 text-center ${
                  globalAlert.type === "error"
                    ? "bg-red-50"
                    : globalAlert.type === "success"
                      ? "bg-green-50"
                      : "bg-blue-50"
                }`}
              >
                <div
                  className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
                    globalAlert.type === "error"
                      ? "bg-red-100 text-red-600"
                      : globalAlert.type === "success"
                        ? "bg-green-100 text-green-600"
                        : "bg-blue-100 text-blue-600"
                  }`}
                >
                  {globalAlert.type === "error" ? (
                    <AlertCircle size={32} />
                  ) : globalAlert.type === "success" ? (
                    <CheckCircle size={32} />
                  ) : (
                    <Info size={32} />
                  )}
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  {globalAlert.title}
                </h3>
                <p className="text-gray-600 text-sm whitespace-pre-wrap">
                  {globalAlert.message}
                </p>
              </div>
              <div className="p-6 bg-gray-50/50 text-center">
                <button
                  onClick={() =>
                    setGlobalAlert({ ...globalAlert, show: false })
                  }
                  className={`w-full py-4 rounded-2xl font-bold text-white transition-all active:scale-95 shadow-lg ${
                    globalAlert.type === "error"
                      ? "bg-red-600 hover:bg-red-700 shadow-red-100"
                      : globalAlert.type === "success"
                        ? "bg-green-600 hover:bg-green-700 shadow-green-100"
                        : "bg-blue-600 hover:bg-blue-700 shadow-blue-100"
                  }`}
                >
                  확인
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      
      {/* Logout Confirmation Modal */}
      <AnimatePresence>
        {showLogoutConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
              onClick={() => setShowLogoutConfirm(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-sm rounded-[32px] overflow-hidden shadow-2xl relative z-10"
            >
              <div className="p-8 text-center bg-gray-50 border-b border-gray-100">
                <div className="w-16 h-16 rounded-3xl bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4 shadow-inner">
                  <LogOut size={32} />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">로그아웃</h3>
                <p className="text-gray-600 text-sm">
                  정말 로그아웃 하시겠습니까?<br />
                  활동 내역은 안전하게 저장됩니다.
                </p>
              </div>
              <div className="p-6 bg-white grid grid-cols-2 gap-3">
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="py-4 rounded-2xl font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 transition-all active:scale-95"
                >
                  취소
                </button>
                <button
                  onClick={() => {
                    setShowLogoutConfirm(false);
                    handleLogout();
                  }}
                  className="py-4 rounded-2xl font-bold text-white bg-red-600 hover:bg-red-700 shadow-lg shadow-red-100 transition-all active:scale-95"
                >
                  로그아웃
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

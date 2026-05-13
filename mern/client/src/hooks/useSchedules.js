import { useState, useEffect } from "react";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";

const useSchedules = () => {
  const { currentUser } = useAuth();
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(false);

  const getRef = () =>
    currentUser ? collection(db, "users", currentUser.uid, "schedules") : null;

  const fetchSchedules = async () => {
    const ref = getRef();
    if (!ref) return;
    setLoading(true);
    try {
      const q = query(ref, orderBy("updatedAt", "desc"));
      const snap = await getDocs(q);
      setSchedules(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedules();
  }, [currentUser]);

  // Creates or updates a schedule. Returns the document id.
  const saveSchedule = async (name, grid, existingId = null) => {
    const ref = getRef();
    if (!ref) throw new Error("Not signed in");
    const docRef = existingId ? doc(ref, existingId) : doc(ref);
    await setDoc(
      docRef,
      {
        name,
        schedule: grid,
        updatedAt: serverTimestamp(),
        ...(existingId ? {} : { createdAt: serverTimestamp() }),
      },
      { merge: true }
    );
    await fetchSchedules();
    return docRef.id;
  };

  const renameSchedule = async (id, newName) => {
    const ref = getRef();
    if (!ref) return;
    await updateDoc(doc(ref, id), { name: newName, updatedAt: serverTimestamp() });
    setSchedules((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name: newName } : s))
    );
  };

  const deleteSchedule = async (id) => {
    const ref = getRef();
    if (!ref) return;
    await deleteDoc(doc(ref, id));
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  };

  return { schedules, loading, saveSchedule, renameSchedule, deleteSchedule, fetchSchedules };
};

export default useSchedules;

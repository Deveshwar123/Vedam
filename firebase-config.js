// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyCxZ4K17JB8ZQtcF9kD-X8HOi1XKwbKFU8",
  authDomain: "vedam-4b313.firebaseapp.com",
  projectId: "vedam-4b313",
  storageBucket: "vedam-4b313.firebasestorage.app",
  messagingSenderId: "894664816324",
  appId: "1:894664816324:web:08eeb2b56c70b6761f7b91"
};

// Initialize Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, getDocs, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, collection, addDoc, query, where, getDocs, deleteDoc, doc };

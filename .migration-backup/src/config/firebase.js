import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// TODO: Replace with your actual Firebase project configuration

const firebaseConfig = {
  apiKey: "AIzaSyBywVI9Pn4VtqKEChySDvhkyJMsAhpFnww",
  authDomain: "b2b-infra-tracker.firebaseapp.com",
  projectId: "b2b-infra-tracker",
  storageBucket: "b2b-infra-tracker.firebasestorage.app",
  messagingSenderId: "592450779625",
  appId: "1:592450779625:web:f384a64e103c412a7e3378",
  measurementId: "G-X5QX6YR6EC"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
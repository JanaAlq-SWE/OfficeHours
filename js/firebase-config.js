
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDDD1RRaSPM5-e9pCEEfUKDwZGTdclqL1Y",
  authDomain: "officehourse.firebaseapp.com",
  projectId: "officehourse",
  storageBucket: "officehourse.firebasestorage.app",
  messagingSenderId: "975544971634",
  appId: "1:975544971634:web:4964568b3ecf2b336c2deb",
  measurementId: "G-P7XHMQRT6V"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

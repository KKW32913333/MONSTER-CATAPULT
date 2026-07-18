/* ==========================================================
   mc-firebase.js — オンラインランキング連携（任意設定）
   下の firebaseConfig にプロジェクト情報を入れると自動的に有効化されます。
   未設定のままでもゲームは問題なく動作します（ランキング機能のみ無効）。
   ========================================================== */
(function(){
  'use strict';
  const firebaseConfig = {
    apiKey:"", authDomain:"", projectId:"", storageBucket:"", messagingSenderId:"", appId:"",
  };
  if(!firebaseConfig.apiKey){ return; }

  const V = '10.12.2';
  Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]).then(([appMod, fsMod])=>{
    const app = appMod.initializeApp(firebaseConfig);
    const db = fsMod.getFirestore(app);
    const { collection, addDoc, query, orderBy, limit, getDocs } = fsMod;
    window.CatapultFirebase = {
      submitScore(name, score, onOk, onErr){
        addDoc(collection(db,'scores'), {name:String(name).slice(0,12), score:Number(score)||0, createdAt:Date.now()})
          .then(()=> onOk && onOk()).catch(e=> onErr && onErr(e));
      },
      fetchTopScores(onOk, onErr){
        const q = query(collection(db,'scores'), orderBy('score','desc'), limit(10));
        getDocs(q).then(snap=>{
          const list=[]; snap.forEach(d=> list.push(d.data()));
          onOk && onOk(list);
        }).catch(e=> onErr && onErr(e));
      }
    };
  }).catch(()=>{ window.CatapultFirebase = null; });
})();
/* 推奨Firestoreルール:
rules_version='2';
service cloud.firestore{
  match /databases/{database}/documents{
    match /scores/{doc}{
      allow read:if true;
      allow create:if request.resource.data.score is number
                    && request.resource.data.name is string
                    && request.resource.data.name.size() <= 12;
    }
  }
}
*/

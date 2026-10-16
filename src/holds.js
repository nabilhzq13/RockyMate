/* Hold types, their icons, and the animated technique examples.
   Used by buildBeta() (tips) and app.js (Hold type tool, demo player, Learn
   tab). Technique sources are listed in the Learn tab. */
const HOLD_ORDER=['jug','crimp','sloper','pinch','pocket','sidepull','gaston','undercling','volume'];
const HOLD_TYPES={
  jug:{name:'Jug',grip:'Wrap all your fingers over the lip.',body:'A place to rest: hang on straight arms and shake out each hand.',
    line:'Big and deep. Wrap your fingers over it and rest.'},
  crimp:{name:'Crimp',grip:'Half crimp: fingertips on the edge, fingers bent, thumb beside your index finger.',body:'Push hard with your feet to take weight off your fingers, and move quickly.',
    line:'A small edge for your fingertips. Feet do the work.'},
  sloper:{name:'Sloper',grip:'Open hand, with as much skin on it as you can.',body:'Keep your arm straight and your hips low, under the hold. Swing your hips toward the next hold, then reach.',
    line:'Round, with no lip. Open hand, hips low, move with a swing.'},
  pinch:{name:'Pinch',grip:'Squeeze between your thumb and fingers.',body:'Keep your elbow low and your hips close to the wall.',
    line:'Squeeze it between thumb and fingers.'},
  pocket:{name:'Pocket',grip:'Put in your strongest fingers, usually middle and ring.',body:'Set both feet first and move slowly, so your fingers don\'t twist in the hole.',
    line:'A hole. Strongest fingers in, feet set, slow moves.'},
  sidepull:{name:'Sidepull',grip:'Grip the edge that faces sideways and pull it toward your body.',body:'Lean away from it and push your feet the other way.',
    line:'Faces sideways. Pull it in and lean away.'},
  gaston:{name:'Gaston',grip:'Thumb down and elbow out: push it away from your body, like opening a sliding door.',body:'Keep it near your chest and step your feet up high.',
    line:'Faces away from you. Push it outward, elbow out.'},
  undercling:{name:'Undercling',grip:'Palm up: pull up on the edge underneath.',body:'Step your feet up high and stand up until the hold is at your waist, then reach.',
    line:'Faces down. Feet high, stand up, hold it at your waist.'},
  volume:{name:'Volume',grip:'Press with an open palm, or grip its edges.',body:'Great to stand on: step onto it, move your hips over it and stand up.',
    line:'A big shape on the wall. Use its edges, stand on its faces.'}
};
/* Icons in a 24 x 24 box: the hold's shape, and its darker gripping edge.
   Sidepull, gaston and undercling are a jug turned to face sideways, toward
   you, or down; `rot` turns the jug icon (radians). */
const JUG_ICON={body:'M4 14c0-5 3.6-9 8-9s8 4 8 9c0 3-2 5-5 5H9c-3 0-5-2-5-5z',mark:'M6.6 11.4c1.2-3 3-4.3 5.4-4.3s4.2 1.3 5.4 4.3c-1.6-1-3.4-1.5-5.4-1.5s-3.8.5-5.4 1.5z'};
const HOLD_ICON={
  jug:JUG_ICON,
  crimp:{body:'M3 10.6h18a1.9 1.9 0 0 1 0 3.8H3a1.9 1.9 0 0 1 0-3.8z',mark:'M3.2 10.6h17.6v1.3H3.2z'},
  sloper:{body:'M3 17.2c0-6.2 4-10.7 9-10.7s9 4.5 9 10.7c0 .9-.7 1.3-1.6 1.3H4.6c-.9 0-1.6-.4-1.6-1.3z',mark:null},
  pinch:{body:'M9.2 3.2h5.6a2.2 2.2 0 0 1 2.2 2.2v13.2a2.2 2.2 0 0 1-2.2 2.2H9.2A2.2 2.2 0 0 1 7 18.6V5.4a2.2 2.2 0 0 1 2.2-2.2z',mark:'M7 7.6h2v8.8H7zM15 7.6h2v8.8h-2z'},
  pocket:{body:'M12 3.6a8.4 8.4 0 1 1 0 16.8a8.4 8.4 0 1 1 0-16.8z',mark:'M8.3 11.4a3.7 2.7 0 1 0 7.4 0a3.7 2.7 0 1 0-7.4 0z'},
  sidepull:Object.assign({rot:Math.PI/2},JUG_ICON),
  gaston:Object.assign({rot:-Math.PI/2},JUG_ICON),
  undercling:Object.assign({rot:Math.PI},JUG_ICON),
  volume:{body:'M2.5 20.5L12 3.5l9.5 17z',mark:'M12 3.5l9.5 17H12z'}
};
function holdIconSvg(type){
  const ic=HOLD_ICON[type]; if(!ic) return '';
  const t=ic.rot?` transform="rotate(${Math.round(ic.rot*180/Math.PI)} 12 12)"`:'';
  return `<svg viewBox="0 0 24 24" aria-hidden="true" class="hicon"><g${t}><path d="${ic.body}" fill="currentColor"/>${ic.mark?`<path class="mk" d="${ic.mark}"/>`:''}</g></svg>`;
}
/* Technique examples, in cm on a small wall section (x -108..108, floor at
   y 0). A 170 cm climber; each key is a held position: hands lh/rh, feet
   lf/rf (null = off the wall), hips C. Moving from one key to the next uses
   the same timing as the route player: on a hand move the hips lead and the
   hand follows, on a foot move the foot goes first and the hips follow.
   sag: the hips swing through low, like a pendulum. shake: that hand hangs
   free and shakes out. force: an arrow showing which way to pull or push.
   Holds: t type (or 'foot'), x y centre, s size in cm, face which way a
   sidepull or gaston opens, main for the holds the example is about (they get
   a name tag, beside them or lab:'below'). */
const DEMOS={
  jug:{title:'Rest on a jug',
    holds:[{t:'jug',x:-16,y:240,s:15,main:1},{t:'jug',x:20,y:236,s:15,main:1},{t:'foot',x:-24,y:44},{t:'foot',x:24,y:48}],
    keys:[
      {lh:[-16,240],rh:[20,236],lf:[-24,44],rf:[24,48],C:[2,114],cap:'Jugs are the biggest holds. Wrap your fingers over the lip and hang on straight arms, so your skeleton takes the weight.'},
      {lh:[-40,100],rh:[20,236],lf:[-24,44],rf:[24,48],C:[8,112],shake:'lh',cap:'Drop one arm below your waist and shake it out. Breathe.'},
      {lh:[-16,240],rh:[20,236],lf:[-24,44],rf:[24,48],C:[2,114],cap:'Put it back and hang straight-armed again.'},
      {lh:[-16,240],rh:[44,102],lf:[-24,44],rf:[24,48],C:[-4,112],shake:'rh',cap:'Then shake out the other arm.'},
      {lh:[-16,240],rh:[20,236],lf:[-24,44],rf:[24,48],C:[2,114],cap:'Rested. Climb on before your feet get tired.'}]},
  crimp:{title:'Crimps: let your feet do the work',
    holds:[{t:'crimp',x:-34,y:214,s:10,main:1},{t:'crimp',x:14,y:222,s:10,main:1},{t:'crimp',x:-14,y:262,s:10,main:1},{t:'foot',x:-24,y:44},{t:'foot',x:24,y:48},{t:'foot',x:-26,y:92}],
    keys:[
      {lh:[-34,214],rh:[14,222],lf:[-24,44],rf:[24,48],C:[0,108],cap:'Crimps are small edges. Half crimp: fingertips on the edge, fingers bent, thumb beside your index finger.'},
      {lh:[-34,214],rh:[14,222],lf:[-26,92],rf:[24,48],C:[-6,112],cap:'Feet first. Step up onto a higher foothold.',force:[[-26,104],[-26,84]]},
      {lh:[-34,214],rh:[14,222],lf:[-26,92],rf:[24,48],C:[-10,140],cap:'Stand up through that foot. Your legs take the weight off your fingers.',force:[[-26,104],[-26,84]]},
      {lh:[-14,262],rh:[14,222],lf:[-26,92],rf:[24,48],C:[-10,140],move:700,cap:'Reach quickly and precisely. Small holds don\'t reward slow, hesitant moves.'}]},
  sloper:{title:'Slopers: hips low, swing through',
    holds:[{t:'sloper',x:-30,y:222,s:18,main:1},{t:'sloper',x:10,y:216,s:16,main:1},{t:'sloper',x:40,y:246,s:18,main:1},{t:'foot',x:-22,y:42},{t:'foot',x:24,y:44}],
    keys:[
      {lh:[-30,222],rh:[10,216],lf:[-22,42],rf:[24,44],C:[-8,100],cap:'Slopers are round, with no lip. Open your hand and get as much skin on the hold as you can.'},
      {lh:[-30,222],rh:[10,216],lf:[-22,42],rf:[24,44],C:[-22,96],move:800,cap:'Keep your arms straight and your hips low, under the holds.'},
      {lh:[-30,222],rh:[10,216],lf:[-22,42],rf:[24,44],C:[12,118],sag:9,move:1000,hold:250,cap:'Swing your hips toward the next sloper…',force:[[-14,104],[20,128]]},
      {lh:[-30,222],rh:[40,246],lf:[-22,42],rf:[24,44],C:[14,120],move:520,hold:700,cap:'…and catch it as the swing peaks, fingers open.'},
      {lh:[-30,222],rh:[40,246],lf:[-22,42],rf:[24,44],C:[14,114],cap:'Settle low under both holds, arms straight. Smooth moves keep you on.'}]},
  pinch:{title:'Pinches: squeeze with your thumb',
    holds:[{t:'pinch',x:-24,y:226,s:14,main:1},{t:'pinch',x:30,y:218,s:14,main:1},{t:'pinch',x:20,y:262,s:14,main:1},{t:'foot',x:-24,y:44},{t:'foot',x:24,y:46},{t:'foot',x:26,y:90}],
    keys:[
      {lh:[-24,226],rh:[30,218],lf:[-24,44],rf:[24,46],C:[0,112],cap:'Pinches: squeeze between your thumb and fingers. Grab where the width fits your hand.'},
      {lh:[-24,226],rh:[30,218],lf:[-24,44],rf:[26,90],C:[6,116],cap:'Keep your elbows low and step a foot up.'},
      {lh:[-24,226],rh:[30,218],lf:[-24,44],rf:[26,90],C:[8,136],cap:'Stand up on it, squeezing all the way.'},
      {lh:[-24,226],rh:[20,262],lf:[-24,44],rf:[26,90],C:[8,136],cap:'Reach to the next pinch with your thumb ready to wrap it.'}]},
  pocket:{title:'Pockets: strong fingers, still feet',
    holds:[{t:'pocket',x:-32,y:222,s:12,main:1},{t:'jug',x:22,y:222,s:14},{t:'pocket',x:12,y:262,s:12,main:1},{t:'foot',x:-24,y:44},{t:'foot',x:24,y:46},{t:'foot',x:-24,y:82}],
    keys:[
      {lh:[-32,222],rh:[22,222],lf:[-24,44],rf:[24,46],C:[0,112],cap:'Pockets are holes. Use your strongest fingers, usually middle and ring.'},
      {lh:[-32,222],rh:[22,222],lf:[-24,82],rf:[24,46],C:[-6,116],cap:'Set your feet first, both on, before a hand lets go.'},
      {lh:[-32,222],rh:[22,222],lf:[-24,82],rf:[24,46],C:[-6,134],cap:'Stand up smoothly. Keep the pocket hand still so your fingers don\'t twist.'},
      {lh:[-32,222],rh:[12,262],lf:[-24,82],rf:[24,46],C:[-6,134],move:1300,cap:'Reach slowly and place your fingers precisely: a static move.'}]},
  sidepull:{title:'Sidepulls: lean away',
    holds:[{t:'sidepull',x:-56,y:186,s:16,face:'left',main:1},{t:'jug',x:10,y:210,s:14},{t:'jug',x:34,y:252,s:14},{t:'foot',x:-30,y:46},{t:'foot',x:10,y:44}],
    keys:[
      {lh:[-56,186],rh:[10,210],lf:[-30,46],rf:[10,44],C:[-8,112],cap:'A sidepull faces sideways. Grip its edge and pull it toward your body.'},
      {lh:[-56,186],rh:[10,210],lf:[-30,46],rf:[10,44],C:[16,116],move:1100,cap:'Lean away from it and push your feet the other way. The opposition holds you on.',force:[[-48,186],[-22,186]]},
      {lh:[-56,186],rh:[34,252],lf:[-30,46],rf:[10,44],C:[18,124],cap:'Now the other hand can reach far, held on by the lean.',force:[[-48,186],[-22,186]]}]},
  gaston:{title:'Gastons: push it open',
    holds:[{t:'gaston',x:24,y:190,s:15,face:'left',main:1,lab:'below'},{t:'jug',x:-30,y:214,s:14},{t:'jug',x:-20,y:262,s:14},{t:'foot',x:-22,y:44},{t:'foot',x:22,y:46},{t:'foot',x:24,y:88}],
    keys:[
      {lh:[-30,214],rh:[24,190],lf:[-22,44],rf:[22,46],C:[-4,116],cap:'A gaston faces away from your body. Thumb down, elbow out, and push it outward, like opening a sliding door.',force:[[30,182],[54,182]]},
      {lh:[-30,214],rh:[24,190],lf:[-22,44],rf:[24,88],C:[2,120],cap:'Keep pushing out and step a foot up high.',force:[[30,182],[54,182]]},
      {lh:[-30,214],rh:[24,190],lf:[-22,44],rf:[24,88],C:[4,138],cap:'Stand up. The push gets stronger as the hold comes down to your chest.',force:[[30,182],[54,182]]},
      {lh:[-20,262],rh:[24,190],lf:[-22,44],rf:[24,88],C:[4,138],cap:'Then reach high with the other hand.'}]},
  undercling:{title:'Underclings: feet high, stand up',
    holds:[{t:'undercling',x:30,y:150,s:15,main:1,lab:'below'},{t:'jug',x:-28,y:212,s:14},{t:'jug',x:-14,y:276,s:14},{t:'foot',x:-22,y:44},{t:'foot',x:22,y:46},{t:'foot',x:-22,y:96},{t:'foot',x:26,y:104}],
    keys:[
      {lh:[-28,212],rh:[30,150],lf:[-22,44],rf:[22,46],C:[0,112],cap:'An undercling faces down. Palm up, and pull up on it.',force:[[40,142],[40,166]]},
      {lh:[-28,212],rh:[30,150],lf:[-22,96],rf:[22,46],C:[-4,118],cap:'Walk your feet up high…'},
      {lh:[-28,212],rh:[30,150],lf:[-22,96],rf:[26,104],C:[2,122],cap:'…both of them.'},
      {lh:[-28,212],rh:[30,150],lf:[-22,96],rf:[26,104],C:[4,160],move:1100,cap:'Stand up until the hold is at your waist and your arm is almost straight.',force:[[40,142],[40,166]]},
      {lh:[-14,276],rh:[30,150],lf:[-22,96],rf:[26,104],C:[4,160],cap:'Now you can reach far above you.'}]},
  volume:{title:'Volumes: stand on them',
    holds:[{t:'volume',x:8,y:96,s:46,main:1},{t:'jug',x:-28,y:226,s:14},{t:'jug',x:34,y:236,s:14},{t:'jug',x:-12,y:272,s:14},{t:'foot',x:-24,y:44},{t:'foot',x:26,y:46}],
    keys:[
      {lh:[-28,226],rh:[34,236],lf:[-24,44],rf:[26,46],C:[0,116],cap:'Volumes are big shapes bolted to the wall. Grip their edges, and stand on their faces.'},
      {lh:[-28,226],rh:[34,236],lf:[-24,44],rf:[22,98],C:[6,120],cap:'Step onto it with the sole pressed flat on its face.',force:[[22,112],[22,92]]},
      {lh:[-28,226],rh:[34,236],lf:[-4,92],rf:[22,98],C:[8,124],cap:'Bring the other foot onto it too.'},
      {lh:[-28,226],rh:[34,236],lf:[-4,92],rf:[22,98],C:[8,152],move:1100,cap:'Move your hips over it and stand up.'},
      {lh:[-12,272],rh:[34,236],lf:[-4,92],rf:[22,98],C:[8,152],cap:'Now the next hold is easy to reach.'}]}
};

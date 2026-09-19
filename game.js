(() => {
  const canvas = document.getElementById("c");
  const ammoEl = document.getElementById("ammo");
  const metaEl = document.getElementById("meta");
  const hintEl = document.getElementById("hint");
  const toastEl = document.getElementById("toast");
  const overlay = document.getElementById("overlay");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.setClearColor(0x7ec8e3, 1);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x7ec8e3, 16, 42);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
  camera.position.set(0, 7.4, 11.6);
  camera.lookAt(0, 1.6, 0);
  scene.add(new THREE.HemisphereLight(0xfff1d6, 0x3d5c4a, 0.9));
  const sun = new THREE.DirectionalLight(0xfff3c4, 1);
  sun.position.set(-8, 14, 6);
  sun.castShadow = true;
  scene.add(sun);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(16, 7, 0.3), new THREE.MeshLambertMaterial({ color: 0x1f6f5b }));
  wall.position.set(0, 2.8, -6); wall.receiveShadow = true; scene.add(wall);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshLambertMaterial({ color: 0x8fbf6a }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.15; floor.receiveShadow = true; scene.add(floor);
  const world = new CANNON.World();
  world.gravity.set(0, -16, 0);
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 10;
  world.defaultContactMaterial.friction = 0.42;
  world.defaultContactMaterial.restitution = 0.12;
  const MAT = {
    glass: { color: 0x8fd4e8, op: 0.72, mass: 0.55, hp: 1, shatter: true, pts: 120 },
    wood:  { color: 0xc47a3a, op: 1, mass: 0.9, hp: 2, shatter: false, pts: 80 },
    metal: { color: 0x8ea0b0, op: 1, mass: 1.7, hp: 3, shatter: false, pts: 140 },
    stone: { color: 0x8b8174, op: 1, mass: 2.4, hp: 4, shatter: false, pts: 160 }
  };
  const bodies = [];
  let ball = null, aiming = false, locked = true, shake = 0;
  let ammo = 0, maxAmmo = 0, score = 0, levelIndex = 0, settled = 0, win = false, lose = false;
  const aimStart = new THREE.Vector2(), pull = new THREE.Vector2();
  const tableW = 6.4, tableD = 4.2, tableH = 0.32;
  function box(w, h, d, x, y, z, color, mass) {
    const body = new CANNON.Body({ mass: mass || 0 });
    body.addShape(new CANNON.Box(new CANNON.Vec3(w/2, h/2, d/2)));
    body.position.set(x, y, z);
    body.linearDamping = 0.12;
    body.angularDamping = 0.18;
    world.add(body);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    return { body, mesh };
  }
  box(tableW+0.2, tableH, tableD+0.2, 0, 0, 0, 0xf3e2c4, 0);
  box(tableW+0.35, 0.18, 0.18, 0, 0.21, -tableD/2, 0x5b3a22, 0);
  box(tableW+0.35, 0.18, 0.18, 0, 0.21, tableD/2, 0x5b3a22, 0);
  box(0.18, 0.18, tableD+0.35, -tableW/2, 0.21, 0, 0x5b3a22, 0);
  box(0.18, 0.18, tableD+0.35, tableW/2, 0.21, 0, 0x5b3a22, 0);
  [[-2.6,-1.9],[2.6,-1.9],[-2.6,1.9],[2.6,1.9]].forEach(([x,z]) => box(0.22, 1.1, 0.22, x, -0.72, z, 0x5b3a22, 0));
  const catcher = new CANNON.Body({ mass: 0 });
  catcher.addShape(new CANNON.Plane());
  catcher.quaternion.setFromAxisAngle(new CANNON.Vec3(1,0,0), -Math.PI/2);
  catcher.position.set(0, -1.15, 0);
  world.add(catcher);
  const cannon = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.35, 10), new THREE.MeshLambertMaterial({ color: 0x2b2f36 }));
  barrel.rotation.x = Math.PI/2; barrel.position.z = -0.35; barrel.castShadow = true;
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 0.7), new THREE.MeshLambertMaterial({ color: 0xc44536 }));
  base.position.y = -0.28;
  cannon.add(barrel, base);
  cannon.position.set(0, 0.55, 4.55);
  scene.add(cannon);
  const aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xe8b84a }));
  scene.add(aimLine); aimLine.visible = false;
  function prop(type, sx, sy, sz, x, y, z) {
    const s = MAT[type];
    const mass = Math.max(0.2, sx*sy*sz*3.2*s.mass);
    const item = box(sx, sy, sz, x, y, z, s.color, mass);
    item.mesh.material.transparent = s.op < 1;
    item.mesh.material.opacity = s.op;
    item.type = type; item.hp = s.hp; item.alive = true; item.pts = s.pts;
    bodies.push(item);
    return item;
  }
  function can(type, x, y, z) { return prop(type, 0.38, 0.62, 0.38, x, y, z); }
  const LEVELS = [
    { name: "Cans on parade", ammo: 3, build() { for (let i=-2;i<=2;i++) can("metal", i*0.7, 0.48, -0.2); } },
    { name: "Wood pyramid", ammo: 4, build() {
      [4,3,2,1].forEach((n,r) => { for (let i=0;i<n;i++) prop("wood",0.62,0.42,0.5,(i-(n-1)/2)*0.66,0.37+r*0.42,-0.15); });
    } },
    { name: "Glass wall", ammo: 3, build() {
      for (let r=0;r<3;r++) for (let c=-2;c<=2;c++) prop("glass",0.48,0.48,0.18,c*0.52,0.4+r*0.5,-0.4);
    } },
    { name: "Stone base", ammo: 4, build() {
      prop("stone",1.4,0.38,0.9,0,0.36,-0.2); prop("wood",0.9,0.38,0.7,0,0.74,-0.2);
      for (let i=-1;i<=1;i++) can("glass", i*0.4, 1.16, -0.2);
    } },
    { name: "Split stacks", ammo: 4, build() {
      [-1.6,1.6].forEach(x => { prop("wood",0.7,0.7,0.7,x,0.52,0); prop("metal",0.5,0.5,0.5,x,1.14,0); can("glass",x,1.62,0); });
      prop("stone",0.7,0.4,0.7,0,0.38,-0.8);
    } },
    { name: "Castle", ammo: 5, build() {
      for (let c=-2;c<=2;c++) prop("stone",0.5,0.5,0.5,c*0.54,0.42,-0.5);
      for (let c=-1;c<=1;c++) prop("wood",0.5,0.5,0.5,c*0.54,0.92,-0.5);
      prop("metal",0.5,0.45,0.5,0,1.4,-0.5); can("glass",-1.1,0.48,0.5); can("glass",1.1,0.48,0.5);
    } },
    { name: "Tight alley", ammo: 3, build() {
      for (let z=-1.2;z<=0.8;z+=0.55) { prop("wood",0.28,0.9,0.28,-0.55,0.62,z); prop("wood",0.28,0.9,0.28,0.55,0.62,z); }
      prop("glass",0.7,0.7,0.18,0,0.52,-1.3); prop("metal",0.4,0.4,0.4,0,0.38,0.2);
    } },
    { name: "The pile", ammo: 6, build() {
      const t=["wood","glass","metal","stone","wood","glass","metal","wood","glass"]; let i=0;
      for (let z=-0.8;z<=0.6;z+=0.55) for (let x=-1.2;x<=1.2;x+=0.6) {
        const k=t[i++%t.length]; const h=k==="stone"?0.36:0.44;
        prop(k,0.46,h,0.46,x,0.16+h/2,z);
      }
    } }
  ];
  function toast(text, color) {
    toastEl.textContent = text; toastEl.style.color = color || "#fff"; toastEl.style.opacity = "1";
    setTimeout(() => { toastEl.style.opacity = "0"; }, 900);
  }
  function sync() {
    ammoEl.innerHTML = "";
    for (let i=0;i<maxAmmo;i++) { const d=document.createElement("div"); d.className="shot"+(i>=ammo?" off":""); ammoEl.appendChild(d); }
    metaEl.textContent = (levelIndex+1) + " / " + score;
  }
  function clearDyn() {
    while (bodies.length) { const it=bodies.pop(); world.remove(it.body); scene.remove(it.mesh); }
    if (ball) { world.remove(ball.body); scene.remove(ball.mesh); ball=null; }
  }
  function loadLevel(i) {
    clearDyn(); win=lose=false; settled=0; locked=false;
    levelIndex=((i%LEVELS.length)+LEVELS.length)%LEVELS.length;
    const L=LEVELS[levelIndex]; L.build(); ammo=maxAmmo=L.ammo;
    hintEl.textContent = L.name + " — drag back, release to fire";
    sync();
  }
  function fire(dx, dy) {
    if (locked || ammo<=0 || win) return;
    const power=Math.min(1, Math.hypot(dx,dy)/140);
    if (power<0.12) return;
    if (ball) { world.remove(ball.body); scene.remove(ball.mesh); }
    const body=new CANNON.Body({ mass:1.8 });
    body.addShape(new CANNON.Sphere(0.2));
    body.position.set(cannon.position.x, cannon.position.y+0.15, cannon.position.z-0.2);
    world.add(body);
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(0.2,12,10), new THREE.MeshLambertMaterial({ color:0xf2d36b }));
    mesh.castShadow=true; scene.add(mesh);
    ball={body,mesh};
    const yaw=THREE.MathUtils.clamp(dx/180,-0.7,0.7);
    const pitch=THREE.MathUtils.clamp((-dy)/160,0.12,0.85);
    const speed=10+power*16;
    body.velocity.set(Math.sin(yaw)*speed, pitch*speed*0.85, -Math.cos(yaw)*speed);
    ammo--; sync(); shake=0.18; locked=true;
    setTimeout(() => { if (!win && !lose) locked=false; }, 380);
  }
  function leftOnTable() {
    return bodies.filter(it => {
      const p=it.body.position;
      return Math.abs(p.x)<tableW/2+0.35 && Math.abs(p.z)<tableD/2+0.35 && p.y>-0.2;
    });
  }
  function checkEnd() {
    if (win||lose) return;
    const left=leftOnTable();
    const moving=bodies.some(it=>it.body.velocity.length()>0.35)||(ball&&ball.body.velocity.length()>0.4);
    if (left.length===0) {
      win=true; locked=true; toast("CLEAR","#e8b84a"); score+=50+ammo*25; sync();
      setTimeout(()=>loadLevel(levelIndex+1),1100); return;
    }
    settled = moving ? 0 : settled+1/60;
    if (ammo<=0 && settled>1.15 && left.length) {
      lose=true; locked=true; toast("OUT OF SHOTS","#ff8a7a");
      hintEl.textContent="Retry the table — or skip if you are stuck";
    }
  }
  function ptr(e){ const t=e.touches?e.touches[0]:e; return {x:t.clientX,y:t.clientY}; }
  function down(e){
    if (!overlay.classList.contains("hidden")) return;
    const p=ptr(e); aiming=true; aimStart.set(p.x,p.y); pull.set(0,0); aimLine.visible=true;
  }
  function move(e){
    if (!aiming) return;
    const p=ptr(e); pull.set(p.x-aimStart.x,p.y-aimStart.y);
    const yaw=THREE.MathUtils.clamp(pull.x/180,-0.7,0.7);
    cannon.rotation.y=-yaw;
    const o=cannon.position.clone().add(new THREE.Vector3(0,0.2,0));
    const d=new THREE.Vector3(Math.sin(yaw),0.35,-Math.cos(yaw)).multiplyScalar(3.2);
    aimLine.geometry.setFromPoints([o,o.clone().add(d)]);
  }
  function up(){
    if (!aiming) return;
    aiming=false; aimLine.visible=false; fire(pull.x,pull.y); pull.set(0,0);
  }
  canvas.addEventListener("pointerdown", down);
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  canvas.addEventListener("touchstart", e => { e.preventDefault(); down(e); }, {passive:false});
  addEventListener("touchmove", e => { if (aiming) e.preventDefault(); move(e); }, {passive:false});
  addEventListener("touchend", up);
  document.getElementById("btnStart").onclick = () => { overlay.classList.add("hidden"); score=0; loadLevel(0); };
  document.getElementById("btnReset").onclick = () => loadLevel(levelIndex);
  document.getElementById("btnSkip").onclick = () => loadLevel(levelIndex+1);
  function resize(){
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  }
  addEventListener("resize", resize); resize();
  const clock=new THREE.Clock();
  (function tick(){
    requestAnimationFrame(tick);
    const dt=Math.min(0.033, clock.getDelta());
    world.step(1/60, dt, 3);
    bodies.forEach(it => { it.mesh.position.copy(it.body.position); it.mesh.quaternion.copy(it.body.quaternion); });
    if (ball) { ball.mesh.position.copy(ball.body.position); ball.mesh.quaternion.copy(ball.body.quaternion); }
    if (shake>0) {
      camera.position.set((Math.random()-0.5)*shake, 7.4+(Math.random()-0.5)*shake, 11.6);
      camera.lookAt(0,1.6,0); shake*=0.86;
    }
    if (!locked || win || lose || ammo===0) checkEnd();
    renderer.render(scene, camera);
  })();
})();

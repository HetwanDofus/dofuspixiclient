onClipEvent(load){
   t = 30 + random(30);
   _xscale = t;
   duree = 60 + random(30);
   _yscale = t;
   vy = 2 + 2 * Math.random();
   vx = -10 + 20 * Math.random();
   vch = 0.1 + 0.1 * Math.random();
   vr = 0.03 + 0.1 * Math.random();
   amp = 30 + random(50);
   a = 1.15;
   time = 0;
}

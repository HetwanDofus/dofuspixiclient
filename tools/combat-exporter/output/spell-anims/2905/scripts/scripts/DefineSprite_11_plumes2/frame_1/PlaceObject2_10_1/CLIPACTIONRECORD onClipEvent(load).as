onClipEvent(load){
   t = 30 + random(30);
   _xscale = t;
   duree = 20 + random(30);
   _yscale = t;
   vy = -10 + 20 * Math.random();
   vx = -10 + 20 * Math.random();
   vch = 0.3 + 0.3 * Math.random();
   vr = 0.1 + 0.3 * Math.random();
   amp = 30 + random(50);
   a = 1.15;
   time = 0;
}

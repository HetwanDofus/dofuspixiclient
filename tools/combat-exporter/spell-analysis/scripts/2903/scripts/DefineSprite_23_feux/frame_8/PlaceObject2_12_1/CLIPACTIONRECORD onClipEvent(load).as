onClipEvent(load){
   vg = -9 * Math.random();
   g = 0.67 * Math.random();
   va = 0;
   t = 100 + random(100);
   _xscale = t;
   _yscale = t;
   dmax = 100;
   d = dmax - random(70);
   acc = 1.67 + Math.random() * 5;
   vacc = 1 + 1 * Math.random();
   vx = 10 * (-0.5 + Math.random());
   vy = 10 * (-0.5 + Math.random());
   accx = 0.8 + 0.1 * Math.random();
   accy = 0.8 + 0.1 * Math.random();
   c = 0;
}

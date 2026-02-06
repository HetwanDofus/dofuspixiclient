onClipEvent(load){
   _parent._rotation = random(360);
   vg = -9 * Math.random();
   g = 0.6 * Math.random();
   va = 0;
   t = 200 + random(100);
   _xscale = t;
   _yscale = t;
   dmax = 100;
   _X = 10 + random(20);
   d = dmax - random(70);
   acc = 1.67 + Math.random() * 5;
   vacc = 1 + 1 * Math.random();
}

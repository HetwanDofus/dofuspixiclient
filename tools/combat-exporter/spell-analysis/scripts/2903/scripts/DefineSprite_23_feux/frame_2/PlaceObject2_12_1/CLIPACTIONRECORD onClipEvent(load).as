onClipEvent(load){
   _parent._rotation = random(360);
   vg = -6 * Math.random();
   g = 1 * Math.random();
   va = 0;
   t = 100 + random(100);
   _xscale = t;
   _yscale = t;
   dmax = 100;
   _X = 10 + random(20);
   d = dmax - random(70);
   acc = 3.34 + Math.random() * 5;
   vacc = 1 + 1 * Math.random();
}

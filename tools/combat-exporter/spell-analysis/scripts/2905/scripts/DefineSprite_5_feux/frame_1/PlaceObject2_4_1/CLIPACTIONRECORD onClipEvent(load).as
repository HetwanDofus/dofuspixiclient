onClipEvent(load){
   _parent._rotation = random(360);
   vg = -3 * Math.random();
   g = 2 * Math.random();
   va = 0;
   t = 50 + random(50);
   _xscale = t;
   _yscale = t;
   dmax = 100;
   _X = 10 + random(20);
   d = dmax - random(70);
   acc = 5 + Math.random() * 5;
   vacc = 3 + 3 * Math.random();
}

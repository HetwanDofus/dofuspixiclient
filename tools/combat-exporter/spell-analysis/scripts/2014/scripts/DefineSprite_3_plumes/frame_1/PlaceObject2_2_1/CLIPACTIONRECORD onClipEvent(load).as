onClipEvent(load){
   a = 0;
   time = 0;
   angle = _parent._parent._parent._parent.angle * 3.141592653589793 / 180;
   t = 30 + random(30);
   _xscale = t;
   duree = 60 + random(90);
   _yscale = t;
   vy = -10 * Math.random() + 10 * Math.sin(angle);
   vx = -20 + 40 * Math.random() + 10 * Math.cos(angle);
   vch = 0.1 + 0.1 * Math.random();
   vr = 0.03 + 0.1 * Math.random();
   amp = 30 + random(23);
   fr = 0.8 + 0.15 * Math.random();
}

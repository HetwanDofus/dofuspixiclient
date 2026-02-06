onClipEvent(load){
   valph = 1.3 + random(5);
   ta = random(50);
   t = 50 + 50 * Math.random();
   _xscale = t;
   _yscale = t;
   vx = 40 * (-0.5 + Math.random());
   vy = 20 * (-0.5 + Math.random());
   if(vx < 0)
   {
      sens = -1;
   }
   else
   {
      sens = 1;
   }
   vr = 3 * vx;
}

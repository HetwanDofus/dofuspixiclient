onClipEvent(enterFrame){
   if(t++ == 21)
   {
      px = x1 + (x2 - x1) / 6 + (-0.5 + Math.random()) * 100;
      py = y1 + (y2 - y1) / 6 + (-0.5 + Math.random()) * 50 - 50;
   }
   if(t == 42)
   {
      px = x2;
      py = y2 - 100;
   }
   if(t == 63)
   {
      px = x2;
      py = y2 + 50;
   }
   if(t == 66)
   {
      _parent.gotoAndStop(3);
   }
   vx = (- (_X - px)) / 9;
   vy = (- (_Y - py)) / 9;
   v = Math.sqrt(vx * vx + vy * vy);
   _rotation = Math.atan2(vy,vx) * 57.29746936176985;
   if(v > 6)
   {
      v = 6;
   }
   boule._xscale = 100 + 3 * v;
   boule._yscale = 100 - 3 * v;
   _X = _X + vx;
   _Y = _Y + vy;
}

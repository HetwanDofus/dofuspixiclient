onClipEvent(enterFrame){
   if(c++ == 10)
   {
      tps = 0.15;
   }
   if(c == 75)
   {
      tps = 1;
   }
   _parent._x += vx * tps;
   _parent._y += vy * tps;
   if(t != 1)
   {
      _Y = _Y + v * tps;
      _rotation = _rotation + vr * tps;
      v += 0.75 * tps;
      if(_Y > 0)
      {
         vx /= 2;
         vy /= 5;
         _rotation = 0;
         _Y = 0;
         v = (- v) / 4;
         if(Math.abs(v) < 1)
         {
            vx = 0;
            vy = 0;
            t = 1;
         }
      }
   }
}

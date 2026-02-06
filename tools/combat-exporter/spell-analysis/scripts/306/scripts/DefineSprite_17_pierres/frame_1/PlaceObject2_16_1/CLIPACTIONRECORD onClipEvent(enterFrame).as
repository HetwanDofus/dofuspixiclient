onClipEvent(enterFrame){
   _X = _X + vx;
   _Y = _Y + (vy += 0.3);
   if(_Y > lim)
   {
      _Y = lim;
      vy = (- vy) * 0.6;
      vx *= 0.6;
   }
}

onClipEvent(enterFrame){
   _Y = _Y + v;
   _X = _X + vx;
   v += 0.6;
   if(_Y > 0)
   {
      _Y = 0;
      v = -5 * Math.random();
      vx = -2.5 * Math.random() + 1.25;
   }
}

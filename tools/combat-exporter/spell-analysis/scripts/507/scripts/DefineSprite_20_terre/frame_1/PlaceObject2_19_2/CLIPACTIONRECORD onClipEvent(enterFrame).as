onClipEvent(enterFrame){
   _Y = _Y + v;
   v += 1;
   if(_Y >= 0)
   {
      v = -6 * Math.random();
   }
}

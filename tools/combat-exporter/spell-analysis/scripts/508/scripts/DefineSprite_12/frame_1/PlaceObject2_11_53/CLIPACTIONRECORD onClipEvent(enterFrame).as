onClipEvent(enterFrame){
   if(i++ % 4 == 1)
   {
      _rotation = _rotation - vr;
      if(temps2++ > 21)
      {
         vr *= 0.96;
      }
   }
}

onClipEvent(enterFrame){
   _rotation = _rotation + vr;
   if(temps++ > 84)
   {
      vr *= 0.96;
   }
}

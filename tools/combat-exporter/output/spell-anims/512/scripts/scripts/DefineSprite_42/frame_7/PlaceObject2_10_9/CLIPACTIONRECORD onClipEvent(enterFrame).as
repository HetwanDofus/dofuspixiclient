onClipEvent(enterFrame){
   _rotation = _rotation + vr;
   vr = 46.6 * Math.sin(i += Math.random());
   if(Math.abs(vr) > 100)
   {
      gotoAndStop(2);
   }
   else
   {
      gotoAndStop(1);
   }
}

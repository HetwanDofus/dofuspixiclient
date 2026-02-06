onClipEvent(enterFrame){
   if(random(15) == 1)
   {
      v = 1;
   }
   if(_alpha < 100 & v == 1)
   {
      _alpha = _alpha + 30;
   }
}

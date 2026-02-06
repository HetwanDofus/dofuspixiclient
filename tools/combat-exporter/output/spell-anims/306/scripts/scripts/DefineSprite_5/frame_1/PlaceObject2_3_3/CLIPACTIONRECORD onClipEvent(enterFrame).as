onClipEvent(enterFrame){
   if(c < 6)
   {
      c += 1;
      this.attachMovie("pierres","pierres" + c,c);
   }
}

onClipEvent(load){
   c = 105;
   while(c < 130)
   {
      this.attachMovie("pierres","pierres" + c,c);
      c++;
   }
}

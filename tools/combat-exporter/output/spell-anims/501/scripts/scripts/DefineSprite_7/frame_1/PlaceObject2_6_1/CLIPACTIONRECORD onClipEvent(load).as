onClipEvent(load){
   c = 0;
   while(c < 10)
   {
      this.attachMovie("pierres","pierres" + c,c);
      c++;
   }
}

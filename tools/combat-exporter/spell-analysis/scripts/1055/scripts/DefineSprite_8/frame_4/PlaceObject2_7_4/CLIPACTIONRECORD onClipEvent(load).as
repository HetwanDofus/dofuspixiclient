onClipEvent(load){
   c = 1;
   while(c <= 10)
   {
      this.attachMovie("spire","spire" + c,c);
      eval("spire" + c)._x = _X;
      eval("spire" + c)._y = _Y - random(50);
      eval("spire" + c)._rotation = _rotation;
      eval("spire" + c).c = c;
      c++;
   }
}

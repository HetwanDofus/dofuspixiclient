c = 1;
h = -10;
this.onEnterFrame = function()
{
   if(c < 120)
   {
      this.attachMovie("pepite","pepite" + c,c);
      c++;
   }
};
